/**
 * Apex Coverage Viewer Chrome Extension
 * Version: 1.0.0
 * Author: Baibahv Kumar
 * 
 * This extension integrates with Salesforce Tooling API to provide:
 * - Real-time Apex class coverage metrics
 * - Per-class line coverage analysis
 * - Test method mapping to coverage
 * - Export functionality for coverage reports
 */

// DOM element references for better readability and caching
const form = document.getElementById("config-form");
const loadButton = document.getElementById("load-button");
const sessionButton = document.getElementById("session-button");
const exportButton = document.getElementById("export-button");
const executeTestsButton = document.getElementById("execute-tests-button");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const tableWrapperEl = document.getElementById("table-wrapper");
const coverageBodyEl = document.getElementById("coverage-body");
const searchEl = document.getElementById("search");
const includeMethodDetailsEl = document.getElementById("include-method-details");
const excludePackagesEl = document.getElementById("exclude-packages");
const themeSelectEl = document.getElementById("theme-select");
const methodDetailsSectionEl = document.getElementById("method-details");
const methodDetailsTitleEl = document.getElementById("method-details-title");
const methodDetailsHelpEl = document.getElementById("method-details-help");
const methodDetailsBodyEl = document.getElementById("method-details-body");
const testModalEl = document.getElementById("test-modal");
const testClassSearchEl = document.getElementById("test-class-search");
const testClassesListEl = document.getElementById("test-classes-list");
const modalCloseBtn = document.getElementById("modal-close");
const modalCancelBtn = document.getElementById("modal-cancel");
const selectAllBtn = document.getElementById("select-all-btn");
const deselectAllBtn = document.getElementById("deselect-all-btn");
const executeBtn = document.getElementById("execute-btn");
const testExecutionResultsSectionEl = document.getElementById("test-execution-results");
const testExecutionHelpEl = document.getElementById("test-execution-help");
const testExecutionBodyEl = document.getElementById("test-execution-body");
const abortAllTestsButtonEl = document.getElementById("abort-all-tests-button");
const classListSectionEl = document.getElementById("class-list-section");
const classListContentEl = document.getElementById("class-list-content");
const classListToggleEl = document.getElementById("class-list-toggle");
const methodDetailsContentEl = document.getElementById("method-details-content");
const methodDetailsToggleEl = document.getElementById("method-details-toggle");
const testExecutionContentEl = document.getElementById("test-execution-content");
const testExecutionToggleEl = document.getElementById("test-execution-toggle");
const classCoverageModalEl = document.getElementById("class-coverage-modal");
const classCoverageTitleEl = document.getElementById("class-coverage-title");
const classCoverageSummaryEl = document.getElementById("class-coverage-summary");
const classCoverageBodyEl = document.getElementById("class-coverage-body");
const classCoverageCloseBtn = document.getElementById("class-coverage-close");
const classCoverageDoneBtn = document.getElementById("class-coverage-done");
const sortHeaderButtons = Array.from(document.querySelectorAll(".sort-header"));
const sfUserNameEl = document.getElementById("sf-user-name");
const sfEnvNameEl = document.getElementById("sf-env-name");
const extensionVersionEl = document.getElementById("extension-version");

const TERMINAL_TEST_QUEUE_STATUSES = new Set(["Completed", "Failed", "Aborted"]);
const POLLING_TEST_QUEUE_STATUSES = new Set(["Queued", "Preparing", "Holding", "Processing"]);

let allRows = [];
let visibleRows = [];
let testClasses = [];
let selectedClassId = null;
let currentConfig = null;
let isTestExecutionInProgress = false;
let activeExecutionConfig = null;
let activeExecutionSelectedTestClasses = [];
let activeLatestQueueByClass = new Map();
const pendingAbortClassIds = new Set();
const inFlightAbortClassIds = new Set();
const methodCoverageCache = new Map();
const classCoverageCache = new Map();
const sortState = {
  key: null,
  direction: "asc"
};

const STORAGE_KEY = "apexCoverageConfig";
const launchSourceTabId = parseLaunchSourceTabId();

initialize();

async function initialize() {
  setExtensionVersion();
  excludePackagesEl.disabled = false;
  applyTheme("light");
  await restoreConfig();
  // Not persisted: always off when the popup opens (package classes visible).
  excludePackagesEl.setAttribute("aria-pressed", "false");
  initializeSortingControls();
  initializeSectionToggleControls();

  // Form submission and coverage loading
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadCoverage();
  });

  // Session/token management
  sessionButton.addEventListener("click", async () => {
    await fillSessionFromActiveTab();
  });

  // CSV export functionality
  exportButton.addEventListener("click", () => {
    exportVisibleRowsToCsv();
  });

  // Toggle method-wise view
  includeMethodDetailsEl.addEventListener("click", async (event) => {
    event.preventDefault();
    toggleMethodDetailsView();
    persistUiPreferences();
    await handleMethodViewToggle();
  });

  // Filter package classes
  excludePackagesEl.addEventListener("click", (event) => {
    event.preventDefault();
    toggleExcludePackages();
    persistUiPreferences();
    visibleRows = sortRows(filterRows(allRows, searchEl.value));
    renderRows(visibleRows);
    renderSummary(getSummaryRows(allRows));
  });

  themeSelectEl.addEventListener("change", () => {
    applyTheme(themeSelectEl.value === "dark" ? "dark" : "light");
    persistUiPreferences();
  });

  // Real-time search filtering
  searchEl.addEventListener("input", () => {
    visibleRows = sortRows(filterRows(allRows, searchEl.value));
    renderRows(visibleRows);
    renderSummary(getSummaryRows(allRows));
  });

  // Test execution
  executeTestsButton.addEventListener("click", () => {
    showTestClassesModal();
  });

  testClassSearchEl.addEventListener("input", () => {
    renderTestClassesModalList(testClassSearchEl.value);
  });

  // Modal controls
  modalCloseBtn.addEventListener("click", () => {
    closeTestModal();
  });

  modalCancelBtn.addEventListener("click", () => {
    closeTestModal();
  });

  classCoverageCloseBtn.addEventListener("click", () => {
    closeClassCoverageModal();
  });

  classCoverageDoneBtn.addEventListener("click", () => {
    closeClassCoverageModal();
  });

  // Test class selection
  selectAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".test-class-checkbox").forEach(checkbox => {
      checkbox.checked = true;
    });
  });

  deselectAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".test-class-checkbox").forEach(checkbox => {
      checkbox.checked = false;
    });
  });

  executeBtn.addEventListener("click", async () => {
    await executeSelectedTests();
  });

  abortAllTestsButtonEl.addEventListener("click", async () => {
    await abortAllRunningTests();
  });

  testExecutionBodyEl.addEventListener("click", async (event) => {
    const abortButton = event.target.closest(".test-execution-action-btn");
    if (!abortButton) {
      return;
    }

    const classId = abortButton.getAttribute("data-class-id");
    if (!classId) {
      return;
    }

    await abortSingleTestClassById(classId);
  });

  // Modal backdrop click handler
  testModalEl.addEventListener("click", (event) => {
    if (event.target === testModalEl) {
      closeTestModal();
    }
  });

  classCoverageModalEl.addEventListener("click", (event) => {
    if (event.target === classCoverageModalEl) {
      closeClassCoverageModal();
    }
  });

  // Ensure method details section is hidden on initialization
  methodDetailsSectionEl.classList.add("hidden");
  testExecutionResultsSectionEl.classList.add("hidden");
  setSectionExpanded("classList", true);
  setSectionExpanded("methodDetails", true);
  setSectionExpanded("testExecution", true);

  // Disable export and execute buttons on initialization
  exportButton.disabled = true;
  executeTestsButton.disabled = true;

  // On popup open, try importing session and auto-load coverage.
  await fillSessionFromActiveTab();
  if (form.instanceUrl.value && form.accessToken.value && form.apiVersion.value) {
    await loadCoverage();
  }
}

function setExtensionVersion() {
  if (!extensionVersionEl) {
    return;
  }

  const manifestVersion = chrome.runtime.getManifest().version;
  extensionVersionEl.textContent = manifestVersion ? `v${manifestVersion}` : "v-";
}

function toggleMethodDetailsView() {
  const isPressed = includeMethodDetailsEl.getAttribute("aria-pressed") === "true";
  includeMethodDetailsEl.setAttribute("aria-pressed", !isPressed);
}

function toggleExcludePackages() {
  const isPressed = excludePackagesEl.getAttribute("aria-pressed") === "true";
  excludePackagesEl.setAttribute("aria-pressed", !isPressed);
}

function initializeSectionToggleControls() {
  classListToggleEl.addEventListener("click", () => {
    toggleSection("classList");
  });
  methodDetailsToggleEl.addEventListener("click", () => {
    toggleSection("methodDetails");
  });
  testExecutionToggleEl.addEventListener("click", () => {
    toggleSection("testExecution");
  });
}

function getSectionControls(sectionKey) {
  if (sectionKey === "classList") {
    return { sectionEl: classListSectionEl, contentEl: classListContentEl, toggleEl: classListToggleEl };
  }
  if (sectionKey === "methodDetails") {
    return { sectionEl: methodDetailsSectionEl, contentEl: methodDetailsContentEl, toggleEl: methodDetailsToggleEl };
  }
  if (sectionKey === "testExecution") {
    return {
      sectionEl: testExecutionResultsSectionEl,
      contentEl: testExecutionContentEl,
      toggleEl: testExecutionToggleEl
    };
  }
  return null;
}

function setSectionExpanded(sectionKey, expanded) {
  const controls = getSectionControls(sectionKey);
  if (!controls) {
    return;
  }
  controls.contentEl.classList.toggle("hidden", !expanded);
  controls.toggleEl.setAttribute("aria-expanded", String(expanded));
  controls.toggleEl.textContent = expanded ? "▴" : "▾";
  const sectionName = controls.sectionEl.id.replace(/-/g, " ");
  controls.toggleEl.setAttribute(
    "aria-label",
    expanded ? `Collapse ${sectionName} section` : `Expand ${sectionName} section`
  );
}

function toggleSection(sectionKey) {
  const controls = getSectionControls(sectionKey);
  if (!controls || controls.sectionEl.classList.contains("hidden")) {
    return;
  }

  const isExpanded = controls.toggleEl.getAttribute("aria-expanded") === "true";
  setSectionExpanded(sectionKey, !isExpanded);
}

function expandSectionExclusive(activeSectionKey) {
  setSectionExpanded("classList", activeSectionKey === "classList");
  setSectionExpanded("methodDetails", activeSectionKey === "methodDetails");
  setSectionExpanded("testExecution", activeSectionKey === "testExecution");
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  themeSelectEl.value = isDark ? "dark" : "light";
}

function getCurrentTheme() {
  return document.body.classList.contains("theme-dark") ? "dark" : "light";
}

function persistUiPreferences() {
  const preferences = {
    includeMethodDetails: includeMethodDetailsEl.getAttribute("aria-pressed") === "true",
    theme: getCurrentTheme()
  };
  persistConfig(preferences).catch(() => {
    // ignore transient storage failures
  });
}

function initializeSortingControls() {
  for (const button of sortHeaderButtons) {
    button.addEventListener("click", () => {
      const sortKey = button.getAttribute("data-sort-key");
      if (!sortKey) {
        return;
      }
      toggleSort(sortKey);
    });
  }

  updateSortHeaderIndicators();
}

function toggleSort(sortKey) {
  if (sortState.key === sortKey) {
    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
  } else {
    sortState.key = sortKey;
    sortState.direction = "asc";
  }

  visibleRows = sortRows(visibleRows);
  renderRows(visibleRows);
  updateSortHeaderIndicators();
}

function sortRows(rows) {
  const sorted = [...rows];
  if (!sortState.key) {
    return sorted;
  }

  sorted.sort((left, right) => {
    const direction = sortState.direction === "asc" ? 1 : -1;
    const leftValue = getSortValue(left, sortState.key);
    const rightValue = getSortValue(right, sortState.key);

    const leftMissing = leftValue === null || leftValue === undefined;
    const rightMissing = rightValue === null || rightValue === undefined;
    if (leftMissing && rightMissing) {
      return String(left.name || "").localeCompare(String(right.name || ""));
    }
    if (leftMissing) {
      return 1;
    }
    if (rightMissing) {
      return -1;
    }

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      const delta = (leftValue - rightValue) * direction;
      if (delta !== 0) {
        return delta;
      }
      return String(left.name || "").localeCompare(String(right.name || ""));
    }

    const compare = String(leftValue).localeCompare(
      String(rightValue),
      undefined,
      { sensitivity: "base" }
    );
    if (compare !== 0) {
      return compare * direction;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });

  return sorted;
}

function getSortValue(row, key) {
  if (!row) {
    return null;
  }
  switch (key) {
    case "name":
      return row.name || "";
    case "namespace":
      return row.namespace || "";
    case "covered":
      return Number(row.covered || 0);
    case "uncovered":
      return Number(row.uncovered || 0);
    case "percent":
      return typeof row.percent === "number" ? row.percent : null;
    default:
      return row.name || "";
  }
}

function updateSortHeaderIndicators() {
  for (const button of sortHeaderButtons) {
    const sortKey = button.getAttribute("data-sort-key");
    const th = button.closest("th");
    button.classList.remove("sort-asc", "sort-desc");
    if (th) {
      th.setAttribute("aria-sort", "none");
    }

    if (sortKey && sortKey === sortState.key) {
      const activeClass = sortState.direction === "asc" ? "sort-asc" : "sort-desc";
      button.classList.add(activeClass);
      if (th) {
        th.setAttribute("aria-sort", sortState.direction === "asc" ? "ascending" : "descending");
      }
    }
  }
}

async function restoreConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY];

  if (!config) {
    applyTheme("light");
    return;
  }

  includeMethodDetailsEl.setAttribute(
    "aria-pressed",
    config.includeMethodDetails ?? false
  );
  applyTheme(config.theme === "dark" ? "dark" : "light");
}

async function persistConfig(config) {
  const preferences = {
    includeMethodDetails: Boolean(config.includeMethodDetails),
    theme: config.theme === "dark" ? "dark" : getCurrentTheme()
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: preferences });
}

/**
 * Loads coverage data from Salesforce Tooling API
 * Queries ApexClass and ApexCodeCoverageAggregate objects
 * Separates test classes and renders results with filtering
 */
async function loadCoverage(options = {}) {
  const preserveExpandedSections = options.preserveExpandedSections === true;
  const collapseMethodDetailsSection = options.collapseMethodDetailsSection === true;
  const config = {
    instanceUrl: (form.instanceUrl.value || "").trim().replace(/\/+$/, ""),
    accessToken: (form.accessToken.value || "").trim(),
    apiVersion: (form.apiVersion.value || "").trim(),
    includeMethodDetails: includeMethodDetailsEl.getAttribute("aria-pressed") === "true",
    excludePackages: excludePackagesEl.getAttribute("aria-pressed") === "true"
  };

  if (!config.instanceUrl || !config.accessToken || !config.apiVersion) {
    setStatus("Session not loaded. Please ensure you're logged into Salesforce in your browser.", "error");
    return;
  }

  setLoading(true);
  clearResults();
  setStatus("Loading Apex classes and coverage...", "");

  try {
    currentConfig = config;
    await persistConfig(config);
    methodCoverageCache.clear();
    classCoverageCache.clear();
    selectedClassId = null;

    const classes = await queryAll(
      config,
      "SELECT Id, Name, NamespacePrefix FROM ApexClass ORDER BY Name"
    );

    const coverage = await queryAll(
      config,
      "SELECT ApexClassOrTriggerId, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate WHERE ApexClassOrTriggerId != null"
    );

    // Separate test classes from regular classes
    const { regularClasses, testClassesList } = separateTestClasses(classes);
    testClasses = testClassesList;

    allRows = buildCoverageRows(regularClasses, coverage);
    visibleRows = sortRows(filterRows(allRows, searchEl.value));
    renderRows(visibleRows);
    renderSummary(getSummaryRows(allRows));
    toggleResults(true);
    toggleTestButton(testClasses.length > 0);
    await handleMethodViewToggle();
    if (preserveExpandedSections) {
      setSectionExpanded("classList", true);
    } else {
      expandSectionExclusive("classList");
    }
    if (collapseMethodDetailsSection && !methodDetailsSectionEl.classList.contains("hidden")) {
      setSectionExpanded("methodDetails", false);
    }
    setStatus(`Loaded ${allRows.length} Apex classes (${testClasses.length} test classes).`, "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    setLoading(false);
  }
}

function separateTestClasses(classes) {
  const regularClasses = [];
  const testClassesList = [];

  for (const apexClass of classes) {
    if (isTestClass(apexClass)) {
      testClassesList.push(apexClass);
    } else {
      regularClasses.push(apexClass);
    }
  }

  return { regularClasses, testClassesList };
}

function isTestClass(apexClass) {
  const name = (apexClass.Name || "").toLowerCase();

  // Check if class name ends with "Test" or "Tests"
  if (name.endsWith("test") || name.endsWith("tests")) {
    return true;
  }

  // Check if class name starts with "Test"
  if (name.startsWith("test")) {
    return true;
  }

  return false;
}

function toggleTestButton(show) {
  executeTestsButton.classList.toggle("hidden", !show);
  executeTestsButton.disabled = !show;
}

async function queryAll(config, soql) {
  assertTrustedInstanceUrl(config.instanceUrl);
  const records = [];
  let nextPath = `/services/data/v${config.apiVersion}/tooling/query?q=${encodeURIComponent(soql)}`;

  while (nextPath) {
    const response = await fetch(`${config.instanceUrl}${nextPath}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: "application/json"
      }
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(extractSalesforceError(payload, response.status));
    }

    records.push(...payload.records);
    nextPath = payload.nextRecordsUrl || null;
  }

  return records;
}

function buildCoverageRows(classes, coverageRecords) {
  const byClassId = new Map();

  for (const item of coverageRecords) {
    byClassId.set(item.ApexClassOrTriggerId, {
      covered: item.NumLinesCovered || 0,
      uncovered: item.NumLinesUncovered || 0
    });
  }

  return classes.map((apexClass) => {
    const coverage = byClassId.get(apexClass.Id) || { covered: 0, uncovered: 0 };
    const total = coverage.covered + coverage.uncovered;
    const percent = total === 0 ? null : (coverage.covered / total) * 100;

    return {
      id: apexClass.Id,
      name: apexClass.Name,
      namespace: apexClass.NamespacePrefix || "-",
      covered: coverage.covered,
      uncovered: coverage.uncovered,
      percent
    };
  });
}

/**
 * Renders coverage data rows as table rows with interactive selection
 * @param {Array} rows - Coverage rows to render in the table
 */
function renderRows(rows) {
  coverageBodyEl.innerHTML = "";

  if (rows.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML = `<td colspan="6">No classes found.</td>`;
    coverageBodyEl.appendChild(empty);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.classList.add("clickable-row");
    if (row.id === selectedClassId) {
      tr.classList.add("selected-row");
    }

    const percentText = row.percent === null ? "-" : `${row.percent.toFixed(2)}%`;
    const percentClass = getCoverageClass(row.percent);
    const coverageCellContent = percentClass
      ? `<span class="${percentClass}">${percentText}</span>`
      : percentText;

    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.namespace)}</td>
      <td>${row.covered}</td>
      <td>${row.uncovered}</td>
      <td>${coverageCellContent}</td>
      <td><button type="button" class="secondary row-view-btn">View</button></td>
    `;

    const viewBtn = tr.querySelector(".row-view-btn");
    viewBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await showClassCoverageModal(row.id, row.name);
    });

    tr.addEventListener("click", async () => {
      await handleClassSelection(row.id, row.name);
    });

    coverageBodyEl.appendChild(tr);
  }
}

/**
 * Renders overall coverage summary statistics
 * Calculates aggregate metrics across filtered rows
 * @param {Array} rows - Rows to calculate summary from
 */
function renderSummary(rows) {
  let covered = 0;
  let uncovered = 0;

  for (const row of rows) {
    covered += row.covered;
    uncovered += row.uncovered;
  }

  const totalLines = covered + uncovered;
  const overallPercent = totalLines === 0 ? null : (covered / totalLines) * 100;
  const coverageText = overallPercent === null ? "-" : `${overallPercent.toFixed(2)}%`;

  summaryEl.innerHTML = `
    <div class="summary-item">
      <span class="metric">Classes</span>
      <span class="metric-value">${rows.length}</span>
    </div>
    <div class="summary-item">
      <span class="metric">Total Lines</span>
      <span class="metric-value">${totalLines}</span>
    </div>
    <div class="summary-item">
      <span class="metric">Covered Lines</span>
      <span class="metric-value">${covered}</span>
    </div>
    <div class="summary-item">
      <span class="metric">Uncovered Lines</span>
      <span class="metric-value">${uncovered}</span>
    </div>
    <div class="summary-item">
      <span class="metric">Overall Coverage</span>
      <span class="metric-value">${coverageText}</span>
    </div>
  `;
}

function getSummaryRows(rows) {
  const excludePackages = excludePackagesEl.getAttribute("aria-pressed") === "true";
  if (!excludePackages) {
    return rows;
  }

  return rows.filter((row) => row.namespace === "-");
}

/**
 * Filters coverage rows based on search term and package exclusion setting
 * @param {Array} rows - Coverage data rows to filter
 * @param {string} term - Search term to match class names
 * @returns {Array} Filtered rows matching criteria
 */
function filterRows(rows, term) {
  const normalized = (term || "").trim().toLowerCase();
  const excludePackages = excludePackagesEl.getAttribute("aria-pressed") === "true";

  return rows.filter((row) => {
    // Check name filter
    if (normalized && !row.name.toLowerCase().includes(normalized)) {
      return false;
    }

    // Check package exclusion
    if (excludePackages && row.namespace !== "-") {
      return false;
    }

    return true;
  });
}

function clearResults() {
  allRows = [];
  visibleRows = [];
  selectedClassId = null;
  coverageBodyEl.innerHTML = "";
  renderSummary([]);
  methodDetailsBodyEl.innerHTML = "";
  methodCoverageCache.clear();
  classCoverageCache.clear();
  closeClassCoverageModal();
  toggleResults(false);
}

function toggleResults(show) {
  classListSectionEl.classList.toggle("hidden", !show);
  tableWrapperEl.classList.toggle("hidden", !show);
  searchEl.disabled = !show;
  exportButton.classList.toggle("hidden", !show);
  if (show) {
    setSectionExpanded("classList", true);
  }
  // Enable export button when showing results, disable when hiding
  exportButton.disabled = !show;
  // Hide and disable execute tests button when clearing results; will be shown by toggleTestButton if test classes exist
  if (!show) {
    executeTestsButton.classList.add("hidden");
    executeTestsButton.disabled = true;
  } else {
    executeTestsButton.disabled = false;
  }
  methodDetailsSectionEl.classList.toggle("hidden", true);
}

function setLoading(isLoading) {
  loadButton.disabled = isLoading;
  sessionButton.disabled = isLoading;
  exportButton.disabled = isLoading;
  executeTestsButton.disabled = isLoading;
  includeMethodDetailsEl.disabled = isLoading;
  loadButton.textContent = isLoading ? "Loading..." : "Load Coverage";
  loadButton.classList.toggle("button-loading", isLoading);
  loadButton.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = "status";
  if (type) {
    statusEl.classList.add(type);
  }
}

function getCoverageClass(percent) {
  if (percent === null) {
    return "";
  }
  if (percent >= 75) {
    return "coverage-good";
  }
  if (percent >= 50) {
    return "coverage-medium";
  }
  return "coverage-low";
}

function extractSalesforceError(payload, statusCode) {
  if (Array.isArray(payload) && payload.length > 0) {
    return payload.map((item) => item.message).join("; ");
  }

  if (payload && payload.message) {
    return payload.message;
  }

  return `Salesforce API request failed with status ${statusCode}.`;
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error while loading coverage.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fillSessionFromActiveTab() {
  setStatus("Reading session from selected Salesforce tab...", "");

  try {
    const tab = await getPreferredSalesforceTab();
    if (!tab || !tab.url) {
      throw new Error("No Salesforce tab found. Open Salesforce and try again.");
    }

    const tabUrl = new URL(tab.url);
    if (!isSalesforceHost(tabUrl.hostname)) {
      throw new Error("Active tab is not a Salesforce domain.");
    }

    const candidateOrigins = buildCandidateInstanceOrigins(tabUrl);
    const sidCookie = await findSalesforceSessionCookie(tabUrl, candidateOrigins);

    if (!sidCookie || !sidCookie.value) {
      throw new Error("No Salesforce session found. Please ensure you are logged into Salesforce and try again.");
    }

    const resolvedInstanceUrl = candidateOrigins[0] || tabUrl.origin;
    assertTrustedInstanceUrl(resolvedInstanceUrl);
    form.instanceUrl.value = resolvedInstanceUrl;
    form.accessToken.value = sidCookie.value;

    // Auto-detect API version from Salesforce
    const apiVersion = await detectApiVersion(resolvedInstanceUrl, sidCookie.value);
    form.apiVersion.value = apiVersion;
    await populateHeaderContext({
      instanceUrl: resolvedInstanceUrl,
      accessToken: sidCookie.value,
      apiVersion
    });

    setStatus("Session imported from Salesforce tab.", "success");
  } catch (error) {
    setHeaderContext({
      userName: "Not connected",
      environmentName: "Not connected"
    });
    setStatus(getErrorMessage(error), "error");
  }
}

async function populateHeaderContext(config) {
  try {
    const [userName, environmentName] = await Promise.all([
      fetchCurrentUserName(config),
      fetchEnvironmentName(config)
    ]);

    setHeaderContext({
      userName: userName || "Unknown user",
      environmentName: environmentName || deriveEnvironmentFromUrl(config.instanceUrl)
    });
  } catch (_error) {
    setHeaderContext({
      userName: "Unknown user",
      environmentName: deriveEnvironmentFromUrl(config.instanceUrl)
    });
  }
}

function setHeaderContext({ userName, environmentName }) {
  sfUserNameEl.textContent = userName || "Unknown user";
  sfEnvNameEl.textContent = environmentName || "Unknown environment";
}

function parseLaunchSourceTabId() {
  const params = new URLSearchParams(window.location.search);
  const rawTabId = params.get("sourceTabId");
  if (!rawTabId) {
    return null;
  }

  const tabId = Number(rawTabId);
  return Number.isInteger(tabId) ? tabId : null;
}

function buildCandidateInstanceOrigins(tabUrl) {
  const origins = [];

  // Some Salesforce UIs run on setup/lightning domains while sid/API usually use my.salesforce.com.
  const preferredApiHost = derivePreferredApiHost(tabUrl.hostname);
  if (preferredApiHost) {
    origins.push(`https://${preferredApiHost}`);
  }

  if (isTrustedApiHost(tabUrl.hostname)) {
    origins.push(tabUrl.origin);
  }

  // Deduplicate while preserving priority order.
  return Array.from(new Set(origins));
}

async function findSalesforceSessionCookie(tabUrl, candidateOrigins) {
  for (const origin of candidateOrigins) {
    const originHost = new URL(origin).hostname.toLowerCase();
    if (!isTrustedApiHost(originHost)) {
      continue;
    }
    const cookie = await chrome.cookies.get({
      url: origin,
      name: "sid"
    });
    if (cookie && cookie.value) {
      return cookie;
    }
  }

  return null;
}

async function detectApiVersion(instanceUrl, accessToken) {
  try {
    assertTrustedInstanceUrl(instanceUrl);
    const response = await fetch(`${instanceUrl}/services/data/`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error("Failed to detect API version");
    }

    // Get the latest version from the list
    if (Array.isArray(payload) && payload.length > 0) {
      // Versions are returned as objects with 'version' property
      const latestVersion = payload[payload.length - 1];
      return latestVersion.version || "60.0";
    }

    return "60.0";
  } catch (error) {
    console.error("Error detecting API version:", error);
    return "60.0"; // Fallback to default
  }
}

async function fetchCurrentUserName(config) {
  try {
    const response = await fetch(
      `${config.instanceUrl}/services/data/v${config.apiVersion}/chatter/users/me`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          Accept: "application/json"
        }
      }
    );
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      return "";
    }
    return payload && payload.name ? String(payload.name) : "";
  } catch (_error) {
    return "";
  }
}

async function fetchEnvironmentName(config) {
  try {
    const orgInfo = await querySingleRecord(
      config,
      "SELECT Name, IsSandbox, InstanceName FROM Organization LIMIT 1"
    );
    if (!orgInfo) {
      return deriveEnvironmentFromUrl(config.instanceUrl);
    }

    const orgName = orgInfo.Name || "Salesforce Org";
    const envType = orgInfo.IsSandbox ? "Sandbox" : "Production";
    const instanceName = orgInfo.InstanceName ? ` - ${orgInfo.InstanceName}` : "";
    return `${orgName} (${envType})${instanceName}`;
  } catch (_error) {
    return deriveEnvironmentFromUrl(config.instanceUrl);
  }
}

function deriveEnvironmentFromUrl(instanceUrl) {
  try {
    const host = new URL(instanceUrl).hostname;
    return host;
  } catch (_error) {
    return "Unknown environment";
  }
}

async function querySingleRecord(config, soql) {
  assertTrustedInstanceUrl(config.instanceUrl);
  const queryPath = `/services/data/v${config.apiVersion}/query?q=${encodeURIComponent(soql)}`;
  const response = await fetch(`${config.instanceUrl}${queryPath}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: "application/json"
    }
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    return null;
  }

  const records = Array.isArray(payload.records) ? payload.records : [];
  return records[0] || null;
}

function isSalesforceHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host.endsWith(".salesforce.com") ||
    host.endsWith(".my.salesforce.com") ||
    host.endsWith(".lightning.force.com") ||
    host === "salesforce-setup.com" ||
    host.endsWith(".salesforce-setup.com") ||
    host.endsWith(".my.salesforce-setup.com")
  );
}

function isTrustedApiHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.endsWith(".my.salesforce.com");
}

function assertTrustedInstanceUrl(instanceUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(instanceUrl);
  } catch (_error) {
    throw new Error("Invalid Salesforce instance URL.");
  }

  if (!isTrustedApiHost(parsedUrl.hostname)) {
    throw new Error("Unsupported Salesforce domain. Open an org tab on *.my.salesforce.com and retry.");
  }
}

function derivePreferredApiHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return "";
  }

  if (host.endsWith(".lightning.force.com")) {
    return host.replace(/\.lightning\.force\.com$/i, ".my.salesforce.com");
  }

  if (host.endsWith(".my.salesforce-setup.com")) {
    return host.replace(/\.my\.salesforce-setup\.com$/i, ".my.salesforce.com");
  }

  if (host.endsWith(".salesforce-setup.com")) {
    return host.replace(/\.salesforce-setup\.com$/i, ".my.salesforce.com");
  }

  return "";
}

async function getPreferredSalesforceTab() {
  if (Number.isInteger(launchSourceTabId)) {
    return await getLaunchSourceSalesforceTab();
  }

  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const activeTab = tabs[0] || null;
  if (isSalesforceTab(activeTab)) {
    return activeTab;
  }

  return null;
}

async function getLaunchSourceSalesforceTab() {
  if (!Number.isInteger(launchSourceTabId)) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(launchSourceTabId);
    return isSalesforceTab(tab) ? tab : null;
  } catch (_error) {
    return null;
  }
}

function isSalesforceTab(tab) {
  if (!tab || !tab.url) {
    return false;
  }

  try {
    const tabUrl = new URL(tab.url);
    return isSalesforceHost(tabUrl.hostname);
  } catch (_error) {
    return false;
  }
}

function exportVisibleRowsToCsv() {
  if (visibleRows.length === 0) {
    setStatus("No rows available to export.", "error");
    return;
  }

  const headers = ["Class Name", "Namespace", "Covered", "Uncovered", "Coverage %"];
  const rows = visibleRows.map((row) => [
    row.name,
    row.namespace,
    String(row.covered),
    String(row.uncovered),
    row.percent === null ? "" : row.percent.toFixed(2)
  ]);

  const csvContent = [headers, ...rows]
    .map((columns) => columns.map(toCsvCell).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const blobUrl = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `apex-coverage-${timestamp}.csv`;

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(blobUrl);
  setStatus(`CSV exported (${visibleRows.length} rows).`, "success");
}

function toCsvCell(value) {
  const stringValue = String(value ?? "");
  if (stringValue.includes('"') || stringValue.includes(",") || stringValue.includes("\n")) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

async function handleMethodViewToggle() {
  if (includeMethodDetailsEl.getAttribute("aria-pressed") !== "true" || allRows.length === 0) {
    methodDetailsSectionEl.classList.add("hidden");
    methodDetailsBodyEl.innerHTML = "";
    methodDetailsTitleEl.textContent = "Method Coverage";
    methodDetailsHelpEl.textContent =
      "Enable method-wise view and click a class row to see coverage mapping.";
    renderRows(visibleRows);
    return;
  }

  methodDetailsSectionEl.classList.remove("hidden");
  if (!selectedClassId) {
    selectedClassId = (visibleRows[0] && visibleRows[0].id) || null;
  }

  renderRows(visibleRows);

  const selectedRow = allRows.find((row) => row.id === selectedClassId);
  if (selectedRow) {
    await handleClassSelection(selectedRow.id, selectedRow.name);
  } else {
    methodDetailsHelpEl.textContent = "No class selected. Click a class row.";
    methodDetailsBodyEl.innerHTML = "";
  }
}

async function handleClassSelection(classId, className) {
  selectedClassId = classId;
  renderRows(visibleRows);

  if (includeMethodDetailsEl.getAttribute("aria-pressed") !== "true") {
    return;
  }

  if (!currentConfig) {
    setStatus("Load coverage first to use method-wise mapping.", "error");
    return;
  }

  methodDetailsSectionEl.classList.remove("hidden");
  setSectionExpanded("methodDetails", true);
  methodDetailsTitleEl.textContent = `Method Coverage - ${className}`;
  methodDetailsHelpEl.textContent = "Loading method to test mapping...";
  methodDetailsBodyEl.innerHTML = "";
  focusMethodDetailsSection();

  try {
    const details = await getMethodCoverageDetails(classId);
    renderMethodDetails(details);
    methodDetailsHelpEl.textContent = "Click another class row to switch mapping.";
  } catch (error) {
    methodDetailsHelpEl.textContent = "Could not load method mapping for this class.";
    methodDetailsBodyEl.innerHTML = `<tr><td colspan="2">${escapeHtml(getErrorMessage(error))}</td></tr>`;
  }
}

function focusMethodDetailsSection() {
  methodDetailsSectionEl.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
  methodDetailsSectionEl.focus({
    preventScroll: true
  });
}

async function getMethodCoverageDetails(classId) {
  if (methodCoverageCache.has(classId)) {
    return methodCoverageCache.get(classId);
  }

  const classRecords = await queryAll(
    currentConfig,
    `SELECT Id, Name, Body FROM ApexClass WHERE Id = '${escapeSoqlLiteral(classId)}' LIMIT 1`
  );

  const targetClass = classRecords[0];
  if (!targetClass) {
    throw new Error("Target Apex class not found.");
  }

  const coverageRows = await queryAll(
    currentConfig,
    "SELECT ApexTestClass.Name, TestMethodName, Coverage FROM ApexCodeCoverage " +
      `WHERE ApexClassOrTriggerId = '${escapeSoqlLiteral(classId)}'`
  );

  const methods = extractMethodRanges(targetClass.Body || "");
  const mapped = mapMethodsToTests(methods, coverageRows);
  methodCoverageCache.set(classId, mapped);
  return mapped;
}

function extractMethodRanges(body) {
  const lines = String(body || "").split(/\r?\n/);
  const methods = [];
  let braceDepth = 0;
  let pendingMethod = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const depthBefore = braceDepth;

    if (!pendingMethod) {
      const methodName = extractMethodName(trimmed);
      if (methodName) {
        pendingMethod = {
          name: methodName,
          startLine: index + 1,
          startDepth: depthBefore,
          started: false
        };
      }
    }

    const openCount = countChar(line, "{");
    const closeCount = countChar(line, "}");
    braceDepth += openCount - closeCount;

    if (pendingMethod && !pendingMethod.started && openCount > 0) {
      pendingMethod.started = true;
    }

    if (pendingMethod && pendingMethod.started && braceDepth <= pendingMethod.startDepth) {
      methods.push({
        name: pendingMethod.name,
        startLine: pendingMethod.startLine,
        endLine: index + 1
      });
      pendingMethod = null;
    }
  }

  return methods;
}

function extractMethodName(line) {
  if (!line || line.startsWith("@")) {
    return null;
  }

  const lower = line.toLowerCase();
  const disallowedStarts = [
    "if ",
    "if(",
    "for ",
    "for(",
    "while ",
    "while(",
    "switch ",
    "switch(",
    "catch ",
    "catch(",
    "return ",
    "do ",
    "else",
    "new "
  ];

  if (disallowedStarts.some((value) => lower.startsWith(value))) {
    return null;
  }

  if (!line.includes("(") || !line.includes(")")) {
    return null;
  }

  if (line.endsWith(";")) {
    return null;
  }

  const match = line.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:\{|$)/);
  if (!match) {
    return null;
  }

  return match[1];
}

function mapMethodsToTests(methods, coverageRows) {
  const methodMap = new Map();
  for (const method of methods) {
    methodMap.set(method.name, {
      name: method.name,
      tests: new Set()
    });
  }

  const classLevelTests = new Set();

  for (const row of coverageRows) {
    const testClassName =
      (row.ApexTestClass && row.ApexTestClass.Name) || "UnknownTestClass";
    const testMethodName = row.TestMethodName || "UnknownTestMethod";
    const testLabel = `${testClassName}.${testMethodName}`;
    const coveredLines =
      row.Coverage && Array.isArray(row.Coverage.coveredLines)
        ? row.Coverage.coveredLines
        : [];

    let matched = false;
    for (const method of methods) {
      if (hasLineOverlap(coveredLines, method.startLine, method.endLine)) {
        methodMap.get(method.name).tests.add(testLabel);
        matched = true;
      }
    }

    if (!matched) {
      classLevelTests.add(testLabel);
    }
  }

  const items = Array.from(methodMap.values()).map((entry) => ({
    methodName: entry.name,
    tests: Array.from(entry.tests).sort()
  }));

  if (items.length === 0 && classLevelTests.size > 0) {
    items.push({
      methodName: "Class-level mapping only",
      tests: Array.from(classLevelTests).sort()
    });
  }

  return items;
}

function hasLineOverlap(lines, startLine, endLine) {
  for (const line of lines) {
    if (line >= startLine && line <= endLine) {
      return true;
    }
  }
  return false;
}

function renderMethodDetails(items) {
  methodDetailsBodyEl.innerHTML = "";

  if (!items || items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.textContent = "No method-level mapping found for this class.";
    tr.appendChild(td);
    methodDetailsBodyEl.appendChild(tr);
    return;
  }

  for (const item of items) {
    const testsText = item.tests.length > 0 ? item.tests.join(", ") : "No test mapping";
    const tr = document.createElement("tr");
    const methodCell = document.createElement("td");
    methodCell.textContent = item.methodName;
    const testsCell = document.createElement("td");
    testsCell.textContent = testsText;
    tr.appendChild(methodCell);
    tr.appendChild(testsCell);
    methodDetailsBodyEl.appendChild(tr);
  }
}

function escapeSoqlLiteral(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function countChar(text, char) {
  let count = 0;
  for (const item of text) {
    if (item === char) {
      count += 1;
    }
  }
  return count;
}

function showTestClassesModal() {
  // Check if coverage has been loaded
  if (testClasses.length === 0 || !currentConfig) {
    setStatus("Please load coverage first before executing test classes.", "error");
    return;
  }

  testClassSearchEl.value = "";
  renderTestClassesModalList("");
  testModalEl.classList.remove("hidden");
}

function getFilteredTestClasses(searchTerm = "") {
  const excludePackages = excludePackagesEl.getAttribute("aria-pressed") === "true";
  const normalizedSearchTerm = String(searchTerm || "").trim().toLowerCase();
  
  // Filter test classes based on exclude packages setting
  return testClasses.filter((testClass) => {
    if (excludePackages && testClass.NamespacePrefix && testClass.NamespacePrefix !== "-") {
      return false;
    }
    if (!normalizedSearchTerm) {
      return true;
    }
    return String(testClass.Name || "").toLowerCase().includes(normalizedSearchTerm);
  });
}

function renderTestClassesModalList(searchTerm = "") {
  const selectedIds = new Set(
    Array.from(testClassesListEl.querySelectorAll(".test-class-checkbox:checked")).map((checkbox) => checkbox.value)
  );
  const filteredTestClasses = getFilteredTestClasses(searchTerm);
  testClassesListEl.innerHTML = "";

  if (filteredTestClasses.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.style.textAlign = "center";
    emptyMessage.style.color = "#64748b";
    emptyMessage.textContent = "No test classes found.";
    testClassesListEl.appendChild(emptyMessage);
    return;
  }

  for (const testClass of filteredTestClasses) {
    const item = document.createElement("div");
    item.className = "test-class-item";

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "test-class-checkbox";
    checkbox.value = String(testClass.Id || "");
    checkbox.setAttribute("data-name", String(testClass.Name || ""));
    checkbox.checked = selectedIds.has(checkbox.value);

    const nameText = document.createTextNode(String(testClass.Name || ""));
    const namespace = document.createElement("span");
    namespace.className = "test-namespace";
    namespace.textContent = String(testClass.NamespacePrefix || "-");

    label.appendChild(checkbox);
    label.appendChild(nameText);
    label.appendChild(namespace);
    item.appendChild(label);
    testClassesListEl.appendChild(item);
  }
}

function closeTestModal() {
  testModalEl.classList.add("hidden");
}

async function showClassCoverageModal(classId, className) {
  if (!currentConfig) {
    setStatus("Load coverage first before viewing class coverage lines.", "error");
    return;
  }

  classCoverageModalEl.classList.remove("hidden");
  classCoverageTitleEl.textContent = `Class Coverage - ${className}`;
  classCoverageSummaryEl.textContent = "Loading covered and uncovered lines...";
  classCoverageBodyEl.innerHTML = "<div class=\"class-coverage-message\">Loading...</div>";

  try {
    const details = await getClassCoverageDetails(classId);
    renderClassCoverageModal(details, className);
  } catch (error) {
    classCoverageSummaryEl.textContent = "Could not load class coverage details.";
    classCoverageBodyEl.innerHTML =
      `<div class="class-coverage-message class-coverage-message-error">${escapeHtml(getErrorMessage(error))}</div>`;
  }
}

function closeClassCoverageModal() {
  classCoverageModalEl.classList.add("hidden");
}

async function getClassCoverageDetails(classId) {
  if (classCoverageCache.has(classId)) {
    return classCoverageCache.get(classId);
  }

  const classRecord = await fetchApexClassSource(classId);
  if (!classRecord) {
    throw new Error("Unable to locate selected Apex class.");
  }

  const coverageRows = await queryAll(
    currentConfig,
    "SELECT Coverage FROM ApexCodeCoverage " +
      `WHERE ApexClassOrTriggerId = '${escapeSoqlLiteral(classId)}'`
  );

  const details = buildClassCoverageLineData(classRecord.Body || "", coverageRows);
  classCoverageCache.set(classId, details);
  return details;
}

async function fetchApexClassSource(classId) {
  assertTrustedInstanceUrl(currentConfig.instanceUrl);
  const classUrl =
    `${currentConfig.instanceUrl}/services/data/v${currentConfig.apiVersion}` +
    `/tooling/sobjects/ApexClass/${encodeURIComponent(classId)}`;

  try {
    const response = await fetch(classUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${currentConfig.accessToken}`,
        Accept: "application/json"
      }
    });
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(extractSalesforceError(payload, response.status));
    }
    if (payload && payload.Body) {
      return payload;
    }
  } catch (_error) {
    // Fallback to SOQL query below if direct sObject fetch is not available.
  }

  const classRecords = await queryAll(
    currentConfig,
    `SELECT Id, Name, Body FROM ApexClass WHERE Id = '${escapeSoqlLiteral(classId)}' LIMIT 1`
  );
  return classRecords[0] || null;
}

function buildClassCoverageLineData(classBody, coverageRows) {
  const sourceLines = String(classBody || "").split(/\r?\n/);
  const coveredLines = new Set();
  const uncoveredLines = new Set();

  for (const row of coverageRows) {
    const coverage = row && row.Coverage ? row.Coverage : {};
    const rowCoveredLines = Array.isArray(coverage.coveredLines) ? coverage.coveredLines : [];
    const rowUncoveredLines = Array.isArray(coverage.uncoveredLines) ? coverage.uncoveredLines : [];

    for (const line of rowCoveredLines) {
      if (Number.isInteger(line) && line > 0) {
        coveredLines.add(line);
      }
    }
    for (const line of rowUncoveredLines) {
      if (Number.isInteger(line) && line > 0) {
        uncoveredLines.add(line);
      }
    }
  }

  for (const line of coveredLines) {
    uncoveredLines.delete(line);
  }

  // If Salesforce returns no line-level coverage payload (common for 0% classes),
  // treat the full class source as uncovered so UI and counts are accurate.
  if (coveredLines.size === 0 && uncoveredLines.size === 0) {
    for (let lineNumber = 1; lineNumber <= sourceLines.length; lineNumber += 1) {
      uncoveredLines.add(lineNumber);
    }
  }

  const lineItems = [];
  for (let lineNumber = 1; lineNumber <= sourceLines.length; lineNumber += 1) {
    const isCovered = coveredLines.has(lineNumber);
    const isUncovered = uncoveredLines.has(lineNumber);

    lineItems.push({
      lineNumber,
      status: isCovered ? "Covered" : isUncovered ? "Uncovered" : "Neutral",
      code: sourceLines[lineNumber - 1] || ""
    });
  }

  return {
    coveredCount: coveredLines.size,
    uncoveredCount: uncoveredLines.size,
    lineItems
  };
}

function renderClassCoverageModal(details, className) {
  classCoverageSummaryEl.textContent =
    `${className} - Covered lines: ${details.coveredCount}, ` +
    `Uncovered lines: ${details.uncoveredCount}`;
  classCoverageBodyEl.innerHTML = "";

  if (!details.lineItems || details.lineItems.length === 0) {
    classCoverageBodyEl.innerHTML =
      "<div class=\"class-coverage-message\">No line-level coverage data returned for this class.</div>";
    return;
  }

  for (const item of details.lineItems) {
    const lineEl = document.createElement("div");
    lineEl.className = `class-coverage-line ${getClassCoverageLineClass(item.status)}`;

    const lineNumberEl = document.createElement("span");
    lineNumberEl.className = "class-coverage-line-number";
    lineNumberEl.textContent = String(item.lineNumber);

    const codeEl = document.createElement("span");
    codeEl.className = "class-coverage-line-text";
    codeEl.textContent = item.code || "";

    lineEl.appendChild(lineNumberEl);
    lineEl.appendChild(codeEl);
    classCoverageBodyEl.appendChild(lineEl);
  }
}

function getClassCoverageLineClass(status) {
  if (status === "Covered") {
    return "class-coverage-line-covered";
  }
  if (status === "Uncovered") {
    return "class-coverage-line-uncovered";
  }
  return "class-coverage-line-neutral";
}

async function executeSelectedTests() {
  const selectedCheckboxes = document.querySelectorAll(".test-class-checkbox:checked");

  if (selectedCheckboxes.length === 0) {
    setStatus("Please select at least one test class to execute.", "error");
    return;
  }

  if (isTestExecutionInProgress) {
    setStatus("Test execution is already in progress. Please wait for completion.", "error");
    return;
  }

  const selectedTestClasses = Array.from(selectedCheckboxes).map((cb) => ({
    id: cb.value,
    name: cb.getAttribute("data-name")
  }));

  const executionStartedAt = Date.now();
  setExecutionUiState(true);
  initializeTestExecutionTable(selectedTestClasses);
  setStatus("Queueing test classes in Salesforce Test Execution...", "");
  closeTestModal();

  try {
    // Queue tests via Salesforce Tooling API (async so runs appear in org Test Execution)
    const queuedRunIds = [];
    for (const testClass of selectedTestClasses) {
      const result = await runTestClass(currentConfig, testClass.id, testClass.name);
      if (result && result.runId) {
        queuedRunIds.push(result.runId);
      }
    }

    const uniqueRunIds = Array.from(new Set(queuedRunIds.filter(Boolean)));
    await monitorTestExecution({
      config: currentConfig,
      selectedTestClasses,
      runIds: uniqueRunIds,
      executionStartedAt
    });
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    setExecutionUiState(false);
  }
}

function setExecutionUiState(isRunning) {
  isTestExecutionInProgress = isRunning;
  loadButton.disabled = isRunning;
  executeTestsButton.disabled = isRunning || allRows.length === 0;
  includeMethodDetailsEl.disabled = isRunning;
  executeBtn.disabled = isRunning;
  selectAllBtn.disabled = isRunning;
  deselectAllBtn.disabled = isRunning;
  abortAllTestsButtonEl.disabled = !isRunning;

  if (!isRunning) {
    activeExecutionConfig = null;
    activeExecutionSelectedTestClasses = [];
    activeLatestQueueByClass = new Map();
    pendingAbortClassIds.clear();
    inFlightAbortClassIds.clear();
  }
}

function initializeTestExecutionTable(selectedTestClasses) {
  testExecutionResultsSectionEl.classList.remove("hidden");
  expandSectionExclusive("testExecution");
  testExecutionHelpEl.textContent =
    "Execution started. Tracking queue status for selected test classes...";
  activeExecutionConfig = currentConfig;
  activeExecutionSelectedTestClasses = selectedTestClasses.slice();
  activeLatestQueueByClass = new Map();
  pendingAbortClassIds.clear();
  inFlightAbortClassIds.clear();
  renderExecutionProgressRows(selectedTestClasses, new Map(), true);
}

async function monitorTestExecution({ config, selectedTestClasses, runIds, executionStartedAt }) {
  const selectedClassIds = selectedTestClasses.map((item) => item.id);
  const maxPollAttempts = 120;

  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const queueItems = await fetchRelevantQueueItems(config, runIds, selectedClassIds, executionStartedAt);
    const latestQueueByClass = groupLatestQueueItemByClass(queueItems);
    activeLatestQueueByClass = latestQueueByClass;
    await flushPendingAbortRequests();
    const summary = summarizeQueueExecution(selectedTestClasses, latestQueueByClass);

    renderExecutionProgressRows(selectedTestClasses, latestQueueByClass, false);
    testExecutionHelpEl.textContent =
      `Running: ${summary.running}, queued: ${summary.queued}, ` +
      `completed: ${summary.completed}/${summary.total}, failed: ${summary.failed}, aborted: ${summary.aborted}.`;

    const statusType = summary.failed > 0 ? "error" : "";
    setStatus(
      `Test execution in progress (${summary.completed}/${summary.total} completed, ` +
      `${summary.running} running, ${summary.failed} failed).`,
      statusType
    );

    if (summary.isFinished) {
      const failedResults = await fetchFailedMethodResults(
        config,
        runIds,
        selectedClassIds,
        executionStartedAt
      );
      renderExecutionFinalRows(selectedTestClasses, latestQueueByClass, failedResults);

      const hasFailures = summary.failed > 0 || failedResults.length > 0;
      const completionType = hasFailures ? "error" : "success";
      const completionText = hasFailures
        ? "Test execution completed with failures. Reloading coverage..."
        : "Test execution completed successfully. Reloading coverage...";

      setStatus(completionText, completionType);
      await loadCoverage({
        preserveExpandedSections: true,
        collapseMethodDetailsSection: true
      });

      // If refresh failed, loadCoverage already set an error message.
      if (statusEl.classList.contains("error")) {
        return;
      }

      if (hasFailures) {
        setStatus(
          "Test execution completed with failures and coverage is refreshed. Check Test Class Execution Result for failed methods and errors.",
          "error"
        );
      } else {
        setStatus("Test execution completed successfully and coverage is refreshed.", "success");
      }
      return;
    }

    await sleep(3000);
  }

  throw new Error("Timed out while waiting for test execution to finish.");
}

async function fetchRelevantQueueItems(config, runIds, selectedClassIds, executionStartedAt) {
  const fields =
    "Id, ApexClassId, ApexClass.Name, Status, ExtendedStatus, ParentJobId, TestRunResultId, CreatedDate";
  const queries = [];
  const runIdClause = buildSoqlInClause(runIds);
  const classIdClause = buildSoqlInClause(selectedClassIds);

  if (runIdClause) {
    queries.push(
      `SELECT ${fields} FROM ApexTestQueueItem WHERE ParentJobId IN (${runIdClause}) ORDER BY CreatedDate DESC`
    );
    queries.push(`SELECT ${fields} FROM ApexTestQueueItem WHERE Id IN (${runIdClause}) ORDER BY CreatedDate DESC`);
    queries.push(
      `SELECT ${fields} FROM ApexTestQueueItem WHERE TestRunResultId IN (${runIdClause}) ORDER BY CreatedDate DESC`
    );
  }

  if (classIdClause) {
    queries.push(
      `SELECT ${fields} FROM ApexTestQueueItem WHERE ApexClassId IN (${classIdClause}) ORDER BY CreatedDate DESC`
    );
  }

  const dedupedById = new Map();
  for (const query of queries) {
    try {
      const rows = await queryAll(config, query);
      for (const row of rows) {
        if (!row || !row.Id) {
          continue;
        }
        dedupedById.set(row.Id, row);
      }
      if (dedupedById.size > 0 && runIdClause) {
        break;
      }
    } catch (_error) {
      // Ignore query shape mismatches and continue to the next fallback query.
    }
  }

  const createdAtThreshold = executionStartedAt - 120000;
  return Array.from(dedupedById.values()).filter((row) => {
    const createdAt = Date.parse(row.CreatedDate || "");
    if (!Number.isFinite(createdAt)) {
      return true;
    }
    return createdAt >= createdAtThreshold;
  });
}

function groupLatestQueueItemByClass(queueItems) {
  const byClassId = new Map();

  for (const item of queueItems) {
    const classId = item.ApexClassId;
    if (!classId) {
      continue;
    }

    const existing = byClassId.get(classId);
    if (!existing) {
      byClassId.set(classId, item);
      continue;
    }

    const existingCreated = Date.parse(existing.CreatedDate || "") || 0;
    const currentCreated = Date.parse(item.CreatedDate || "") || 0;
    if (currentCreated >= existingCreated) {
      byClassId.set(classId, item);
    }
  }

  return byClassId;
}

function summarizeQueueExecution(selectedTestClasses, latestQueueByClass) {
  const summary = {
    total: selectedTestClasses.length,
    completed: 0,
    failed: 0,
    aborted: 0,
    running: 0,
    queued: 0,
    waiting: 0,
    isFinished: false
  };

  for (const testClass of selectedTestClasses) {
    const queueItem = latestQueueByClass.get(testClass.id);
    if (!queueItem) {
      summary.waiting += 1;
      continue;
    }

    const status = normalizeQueueStatus(queueItem.Status);
    if (status === "Completed") {
      summary.completed += 1;
    } else if (status === "Failed") {
      summary.failed += 1;
    } else if (status === "Aborted") {
      summary.aborted += 1;
    } else if (POLLING_TEST_QUEUE_STATUSES.has(status)) {
      if (status === "Queued" || status === "Holding") {
        summary.queued += 1;
      } else {
        summary.running += 1;
      }
    } else if (TERMINAL_TEST_QUEUE_STATUSES.has(status)) {
      summary.failed += 1;
    } else {
      summary.running += 1;
    }
  }

  summary.isFinished =
    summary.total > 0 &&
    summary.waiting === 0 &&
    summary.completed + summary.failed + summary.aborted === summary.total;

  return summary;
}

function renderExecutionProgressRows(selectedTestClasses, latestQueueByClass, isInitializing) {
  testExecutionBodyEl.innerHTML = "";

  for (const testClass of selectedTestClasses) {
    const queueItem = latestQueueByClass.get(testClass.id);
    const status = queueItem ? normalizeQueueStatus(queueItem.Status) : "Queued";
    const errorMessage = queueItem
      ? queueItem.ExtendedStatus || "-"
      : isInitializing
        ? "Waiting for Salesforce queue confirmation..."
        : "Still waiting for queue item creation...";

    appendTestExecutionRow({
      classId: testClass.id,
      className: testClass.name,
      failedMethod: "-",
      status,
      errorMessage,
      canAbort: canAbortQueueStatus(status)
    });
  }
}

function renderExecutionFinalRows(selectedTestClasses, latestQueueByClass, failedResults) {
  testExecutionBodyEl.innerHTML = "";

  for (const testClass of selectedTestClasses) {
    const queueItem = latestQueueByClass.get(testClass.id);
    const status = queueItem ? normalizeQueueStatus(queueItem.Status) : "Unknown";
    const errorMessage = queueItem && queueItem.ExtendedStatus ? queueItem.ExtendedStatus : "-";

    appendTestExecutionRow({
      classId: testClass.id,
      className: testClass.name,
      failedMethod: "-",
      status,
      errorMessage,
      canAbort: false
    });
  }

  if (failedResults.length === 0) {
    testExecutionHelpEl.textContent = "All selected test classes executed successfully.";
    return;
  }

  const renderedFailureKeys = new Set();
  for (const item of failedResults) {
    const className =
      (item.ApexClass && item.ApexClass.Name) ||
      item.className ||
      "UnknownClass";
    const methodName = item.MethodName || item.methodName || "UnknownMethod";
    const status = item.Outcome || "Failed";
    const message = item.Message || item.StackTrace || "No error details returned.";
    const dedupeKey = `${className}::${methodName}::${status}::${message}`;

    if (renderedFailureKeys.has(dedupeKey)) {
      continue;
    }
    renderedFailureKeys.add(dedupeKey);

    appendTestExecutionRow({
      className,
      failedMethod: methodName,
      status,
      errorMessage: message,
      canAbort: false
    });
  }

  testExecutionHelpEl.textContent =
    "Execution finished with failures. Failed methods and error messages are listed below.";
}

function appendTestExecutionRow({ classId, className, failedMethod, status, errorMessage, canAbort }) {
  const statusLabel = String(status || "Unknown");
  const tr = document.createElement("tr");
  const classCell = document.createElement("td");
  classCell.textContent = className || "UnknownClass";

  const methodCell = document.createElement("td");
  methodCell.textContent = failedMethod || "-";

  const statusCell = document.createElement("td");
  const statusChip = document.createElement("span");
  statusChip.className = getTestStatusClass(statusLabel);
  statusChip.textContent = statusLabel;
  statusCell.appendChild(statusChip);

  const errorCell = document.createElement("td");
  errorCell.className = "test-error-cell";
  errorCell.textContent = errorMessage || "-";

  const actionCell = document.createElement("td");
  if (classId) {
    const abortButton = document.createElement("button");
    abortButton.type = "button";
    abortButton.className = "secondary test-execution-action-btn";
    abortButton.textContent = "Abort";
    abortButton.setAttribute("data-class-id", String(classId));
    abortButton.disabled = !canAbort || !isTestExecutionInProgress;
    actionCell.appendChild(abortButton);
  } else {
    actionCell.textContent = "-";
  }

  tr.appendChild(classCell);
  tr.appendChild(methodCell);
  tr.appendChild(statusCell);
  tr.appendChild(errorCell);
  tr.appendChild(actionCell);
  testExecutionBodyEl.appendChild(tr);
}

function getTestStatusClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pass" || normalized === "passed" || normalized === "completed") {
    return "test-status test-status-completed";
  }
  if (normalized === "queued" || normalized === "preparing" || normalized === "holding") {
    return "test-status test-status-queued";
  }
  if (normalized === "processing") {
    return "test-status test-status-processing";
  }
  if (normalized === "skip" || normalized === "skipped") {
    return "test-status test-status-skipped";
  }
  if (normalized === "compilefail") {
    return "test-status test-status-compilefail";
  }
  if (normalized === "abort" || normalized === "aborted") {
    return "test-status test-status-aborted";
  }
  if (normalized === "fail" || normalized === "failed") {
    return "test-status test-status-failed";
  }
  return "test-status test-status-failed";
}

function normalizeQueueStatus(status) {
  return String(status || "Queued").trim();
}

function canAbortQueueStatus(status) {
  const normalized = normalizeQueueStatus(status);
  return POLLING_TEST_QUEUE_STATUSES.has(normalized);
}

async function abortSingleTestClassById(classId) {
  if (!isTestExecutionInProgress || !activeExecutionConfig || !classId) {
    return;
  }

  pendingAbortClassIds.add(classId);
  await flushPendingAbortRequests();
}

async function abortAllRunningTests() {
  if (!isTestExecutionInProgress) {
    return;
  }

  for (const testClass of activeExecutionSelectedTestClasses) {
    pendingAbortClassIds.add(testClass.id);
  }
  setStatus("Abort requested for all running/queued test classes.", "");
  await flushPendingAbortRequests();
}

async function flushPendingAbortRequests() {
  if (!isTestExecutionInProgress || !activeExecutionConfig || pendingAbortClassIds.size === 0) {
    return;
  }

  for (const classId of Array.from(pendingAbortClassIds)) {
    if (inFlightAbortClassIds.has(classId)) {
      continue;
    }

    const queueItem = activeLatestQueueByClass.get(classId);
    if (!queueItem || !queueItem.Id) {
      continue;
    }

    const status = normalizeQueueStatus(queueItem.Status);
    if (!canAbortQueueStatus(status)) {
      pendingAbortClassIds.delete(classId);
      continue;
    }

    inFlightAbortClassIds.add(classId);
    try {
      await abortApexTestQueueItem(activeExecutionConfig, queueItem.Id);
      pendingAbortClassIds.delete(classId);
      setStatus(`Abort requested for test class "${queueItem.ApexClass?.Name || classId}".`, "");
    } catch (error) {
      setStatus(getErrorMessage(error), "error");
    } finally {
      inFlightAbortClassIds.delete(classId);
    }
  }
}

async function abortApexTestQueueItem(config, queueItemId) {
  const response = await fetch(
    `${config.instanceUrl}/services/data/v${config.apiVersion}/tooling/sobjects/ApexTestQueueItem/${encodeURIComponent(queueItemId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        Status: "Aborted"
      })
    }
  );

  if (response.ok) {
    return;
  }

  const payload = await parseJsonResponse(response);
  const errorMessage = extractSalesforceError(payload, response.status);
  throw new Error(`Failed to abort test execution: ${errorMessage}`);
}

async function fetchFailedMethodResults(config, runIds, classIds, executionStartedAt) {
  const classIdClause = buildSoqlInClause(classIds);
  const runIdClause = buildSoqlInClause(runIds);
  const conditions = ["Outcome != 'Pass'"];

  if (runIdClause && classIdClause) {
    conditions.push(`(AsyncApexJobId IN (${runIdClause}) OR ApexClassId IN (${classIdClause}))`);
  } else if (runIdClause) {
    conditions.push(`AsyncApexJobId IN (${runIdClause})`);
  } else if (classIdClause) {
    conditions.push(`ApexClassId IN (${classIdClause})`);
  }

  const baseQuery =
    "SELECT ApexClassId, ApexClass.Name, MethodName, Outcome, Message, StackTrace, AsyncApexJobId, TestTimestamp " +
    `FROM ApexTestResult WHERE ${conditions.join(" AND ")} ORDER BY TestTimestamp DESC LIMIT 500`;
  let rows = [];

  try {
    rows = await queryAll(config, baseQuery);
  } catch (_error) {
    if (!classIdClause) {
      return [];
    }
    const fallbackQuery =
      "SELECT ApexClassId, ApexClass.Name, MethodName, Outcome, Message, StackTrace, TestTimestamp " +
      `FROM ApexTestResult WHERE ApexClassId IN (${classIdClause}) AND Outcome != 'Pass' ` +
      "ORDER BY TestTimestamp DESC LIMIT 500";
    rows = await queryAll(config, fallbackQuery);
  }

  const createdAtThreshold = executionStartedAt - 120000;
  return rows.filter((row) => {
    const testTimestamp = Date.parse(row.TestTimestamp || "");
    if (!Number.isFinite(testTimestamp)) {
      return true;
    }
    return testTimestamp >= createdAtThreshold;
  });
}

function buildSoqlInClause(values) {
  const normalized = Array.from(new Set((values || []).filter(Boolean).map((value) => String(value).trim())));
  if (normalized.length === 0) {
    return "";
  }
  return normalized.map((value) => `'${escapeSoqlLiteral(value)}'`).join(", ");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runTestClass(config, classId, className) {
  try {
    // First, get the class name from the ID using SOQL
    const classQuery = await queryAll(
      config,
      `SELECT Id, Name FROM ApexClass WHERE Id = '${escapeSoqlLiteral(classId)}'`
    );

    if (!classQuery || classQuery.length === 0) {
      throw new Error(`Test class with ID ${classId} not found`);
    }

    const testClassName = classQuery[0].Name;

    return await enqueueTestsAsynchronous(config, classId, testClassName);
  } catch (error) {
    throw new Error(`Failed to run test class "${className}": ${error.message}`);
  }
}

async function enqueueTestsAsynchronous(config, classId, testClassName) {
  const baseUrl = `${config.instanceUrl}/services/data/v${config.apiVersion}/tooling/runTestsAsynchronous`;
  const headers = {
    Authorization: `Bearer ${config.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  const attempts = [
    {
      method: "POST",
      url: baseUrl,
      body: {
        classids: classId
      }
    },
    {
      method: "POST",
      url: baseUrl,
      body: {
        classNames: testClassName
      }
    },
    {
      method: "POST",
      url: baseUrl,
      body: {
        tests: [{ className: testClassName }]
      }
    },
    {
      method: "GET",
      url: `${baseUrl}/?classids=${encodeURIComponent(classId)}`
    }
  ];

  const errors = [];

  for (const attempt of attempts) {
    const response = await fetch(attempt.url, {
      method: attempt.method,
      headers,
      body: attempt.body ? JSON.stringify(attempt.body) : undefined
    });
    const payload = await parseJsonResponse(response);

    if (response.ok) {
      const runId = extractAsyncTestRunId(payload);
      return {
        runId,
        payload
      };
    }

    const message = extractSalesforceError(payload, response.status);
    errors.push(message);
  }

  throw new Error(errors.filter(Boolean).join(" | "));
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { message: text };
  }
}

function extractAsyncTestRunId(payload) {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (payload.id) {
    return payload.id;
  }

  if (payload.testRunId) {
    return payload.testRunId;
  }

  if (payload.queueItemId) {
    return payload.queueItemId;
  }

  return null;
}
