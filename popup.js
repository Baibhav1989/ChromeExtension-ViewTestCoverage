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
const searchLabelEl = document.getElementById("search-label");
const includeMethodDetailsEl = document.getElementById("include-method-details");
const excludePackagesEl = document.getElementById("exclude-packages");
const methodDetailsSectionEl = document.getElementById("method-details");
const methodDetailsTitleEl = document.getElementById("method-details-title");
const methodDetailsHelpEl = document.getElementById("method-details-help");
const methodDetailsBodyEl = document.getElementById("method-details-body");
const testModalEl = document.getElementById("test-modal");
const testClassesListEl = document.getElementById("test-classes-list");
const modalCloseBtn = document.getElementById("modal-close");
const modalCancelBtn = document.getElementById("modal-cancel");
const selectAllBtn = document.getElementById("select-all-btn");
const deselectAllBtn = document.getElementById("deselect-all-btn");
const executeBtn = document.getElementById("execute-btn");

let allRows = [];
let visibleRows = [];
let testClasses = [];
let selectedClassId = null;
let currentConfig = null;
const methodCoverageCache = new Map();

const STORAGE_KEY = "apexCoverageConfig";

initialize();

async function initialize() {
  // Default: hide managed-package classes unless user changes it.
  excludePackagesEl.setAttribute("aria-pressed", "true");
  excludePackagesEl.disabled = false; // Enable the exclude packages button by default
  await restoreConfig();
  fillSessionFromActiveTab(); // Auto-load session on startup

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
    await handleMethodViewToggle();
  });

  // Filter package classes
  excludePackagesEl.addEventListener("click", (event) => {
    event.preventDefault();
    toggleExcludePackages();
    visibleRows = filterRows(allRows, searchEl.value);
    renderRows(visibleRows);
    renderSummary(visibleRows);
  });

  // Real-time search filtering
  searchEl.addEventListener("input", () => {
    visibleRows = filterRows(allRows, searchEl.value);
    renderRows(visibleRows);
  });

  // Test execution
  executeTestsButton.addEventListener("click", () => {
    showTestClassesModal();
  });

  // Modal controls
  modalCloseBtn.addEventListener("click", () => {
    closeTestModal();
  });

  modalCancelBtn.addEventListener("click", () => {
    closeTestModal();
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

  // Modal backdrop click handler
  testModalEl.addEventListener("click", (event) => {
    if (event.target === testModalEl) {
      closeTestModal();
    }
  });

  // Ensure method details section is hidden on initialization
  methodDetailsSectionEl.classList.add("hidden");

  // Disable export and execute buttons on initialization
  exportButton.disabled = true;
  executeTestsButton.disabled = true;
}

function toggleMethodDetailsView() {
  const isPressed = includeMethodDetailsEl.getAttribute("aria-pressed") === "true";
  includeMethodDetailsEl.setAttribute("aria-pressed", !isPressed);
}

function toggleExcludePackages() {
  const isPressed = excludePackagesEl.getAttribute("aria-pressed") === "true";
  excludePackagesEl.setAttribute("aria-pressed", !isPressed);
}

async function restoreConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY];

  if (!config) {
    excludePackagesEl.setAttribute("aria-pressed", "true");
    return;
  }

  form.instanceUrl.value = config.instanceUrl || "";
  form.accessToken.value = config.accessToken || "";
  form.apiVersion.value = config.apiVersion || "60.0";
  includeMethodDetailsEl.setAttribute("aria-pressed", Boolean(config.includeMethodDetails));
  excludePackagesEl.setAttribute("aria-pressed", config.excludePackages ?? true);
}

async function persistConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/**
 * Loads coverage data from Salesforce Tooling API
 * Queries ApexClass and ApexCodeCoverageAggregate objects
 * Separates test classes and renders results with filtering
 */
async function loadCoverage() {
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
    visibleRows = filterRows(allRows, searchEl.value);
    renderRows(visibleRows);
    renderSummary(visibleRows);
    toggleResults(true);
    toggleTestButton(testClasses.length > 0);
    await handleMethodViewToggle();
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
    empty.innerHTML = `<td colspan="5">No classes found.</td>`;
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

    tr.innerHTML = `
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.namespace)}</td>
      <td>${row.covered}</td>
      <td>${row.uncovered}</td>
      <td class="${percentClass}">${percentText}</td>
    `;

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
    <span><span class="metric">Classes:</span> ${rows.length}</span>
    <span><span class="metric">Covered Lines:</span> ${covered}</span>
    <span><span class="metric">Uncovered Lines:</span> ${uncovered}</span>
    <span><span class="metric">Overall Coverage:</span> ${coverageText}</span>
  `;
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
  summaryEl.innerHTML = "";
  methodDetailsBodyEl.innerHTML = "";
  methodCoverageCache.clear();
  toggleResults(false);
}

function toggleResults(show) {
  tableWrapperEl.classList.toggle("hidden", !show);
  summaryEl.classList.toggle("hidden", !show);
  searchEl.classList.toggle("hidden", !show);
  searchLabelEl.classList.toggle("hidden", !show);
  exportButton.classList.toggle("hidden", !show);
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
  setStatus("Reading session from a Salesforce tab...", "");

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
    form.instanceUrl.value = resolvedInstanceUrl;
    form.accessToken.value = sidCookie.value;

    // Auto-detect API version from Salesforce
    const apiVersion = await detectApiVersion(resolvedInstanceUrl, sidCookie.value);
    form.apiVersion.value = apiVersion;

    await persistConfig({
      instanceUrl: form.instanceUrl.value,
      accessToken: form.accessToken.value,
      apiVersion: form.apiVersion.value
    });

    setStatus("Session imported from Salesforce tab.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
}

function buildCandidateInstanceOrigins(tabUrl) {
  const origins = [];

  // Lightning pages usually need the sibling my.salesforce.com domain for sid/API.
  if (tabUrl.hostname.endsWith(".lightning.force.com")) {
    const mySalesforceHost = tabUrl.hostname.replace(/\.lightning\.force\.com$/i, ".my.salesforce.com");
    origins.push(`https://${mySalesforceHost}`);
  }

  origins.push(tabUrl.origin);

  // Deduplicate while preserving priority order.
  return Array.from(new Set(origins));
}

async function findSalesforceSessionCookie(tabUrl, candidateOrigins) {
  for (const origin of candidateOrigins) {
    const cookie = await chrome.cookies.get({
      url: origin,
      name: "sid"
    });
    if (cookie && cookie.value) {
      return cookie;
    }
  }

  // Fallback: search across all sid cookies and pick one that best matches the active Salesforce tab.
  const sidCookies = await chrome.cookies.getAll({ name: "sid" });
  if (!Array.isArray(sidCookies) || sidCookies.length === 0) {
    return null;
  }

  const tabHost = tabUrl.hostname.toLowerCase();
  const preferredDomainFromLightning = tabHost.endsWith(".lightning.force.com")
    ? tabHost.replace(/\.lightning\.force\.com$/i, ".my.salesforce.com")
    : "";

  const scored = sidCookies
    .filter((cookie) => cookie && cookie.domain && isSalesforceHost(cookie.domain.replace(/^\./, "")))
    .map((cookie) => {
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();
      let score = 0;
      if (domain === tabHost) {
        score += 4;
      }
      if (preferredDomainFromLightning && domain === preferredDomainFromLightning) {
        score += 3;
      }
      if (tabHost.endsWith(domain)) {
        score += 2;
      }
      if (domain.endsWith(".my.salesforce.com")) {
        score += 1;
      }
      return { cookie, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].cookie : null;
}

async function detectApiVersion(instanceUrl, accessToken) {
  try {
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

function isSalesforceHost(hostname) {
  return (
    hostname.endsWith(".salesforce.com") ||
    hostname.endsWith(".my.salesforce.com") ||
    hostname.endsWith(".sandbox.my.salesforce.com") ||
    hostname.endsWith(".force.com")
  );
}

async function getPreferredSalesforceTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const activeTab = tabs[0] || null;
  if (isSalesforceTab(activeTab)) {
    return activeTab;
  }

  const allTabs = await chrome.tabs.query({});
  const salesforceTabs = allTabs
    .filter((tab) => isSalesforceTab(tab))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

  return salesforceTabs[0] || null;
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
  methodDetailsTitleEl.textContent = `Method Coverage - ${className}`;
  methodDetailsHelpEl.textContent = "Loading method to test mapping...";
  methodDetailsBodyEl.innerHTML = "";

  try {
    const details = await getMethodCoverageDetails(classId);
    renderMethodDetails(details);
    methodDetailsHelpEl.textContent = "Click another class row to switch mapping.";
  } catch (error) {
    methodDetailsHelpEl.textContent = "Could not load method mapping for this class.";
    methodDetailsBodyEl.innerHTML = `<tr><td colspan="2">${escapeHtml(getErrorMessage(error))}</td></tr>`;
  }
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
    methodDetailsBodyEl.innerHTML =
      "<tr><td colspan=\"2\">No method-level mapping found for this class.</td></tr>";
    return;
  }

  for (const item of items) {
    const testsText = item.tests.length > 0 ? item.tests.join(", ") : "No test mapping";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(item.methodName)}</td>
      <td>${escapeHtml(testsText)}</td>
    `;
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

  testClassesListEl.innerHTML = "";

  const excludePackages = excludePackagesEl.getAttribute("aria-pressed") === "true";
  
  // Filter test classes based on exclude packages setting
  const filteredTestClasses = testClasses.filter((testClass) => {
    if (excludePackages && testClass.NamespacePrefix && testClass.NamespacePrefix !== "-") {
      return false;
    }
    return true;
  });

  const listHtml = filteredTestClasses.map((testClass) => `
    <div class="test-class-item">
      <label>
        <input type="checkbox" class="test-class-checkbox" value="${escapeHtml(testClass.Id)}" data-name="${escapeHtml(testClass.Name)}" />
        ${escapeHtml(testClass.Name)}
        <span class="test-namespace">${escapeHtml(testClass.NamespacePrefix || "-")}</span>
      </label>
    </div>
  `).join("");

  if (!listHtml) {
    testClassesListEl.innerHTML = "<p style='text-align: center; color: #64748b;'>No test classes found.</p>";
  } else {
    testClassesListEl.innerHTML = listHtml;
  }

  testModalEl.classList.remove("hidden");
}

function closeTestModal() {
  testModalEl.classList.add("hidden");
}

async function executeSelectedTests() {
  const selectedCheckboxes = document.querySelectorAll(".test-class-checkbox:checked");

  if (selectedCheckboxes.length === 0) {
    setStatus("Please select at least one test class to execute.", "error");
    return;
  }

  const selectedTestClassIds = Array.from(selectedCheckboxes).map(cb => ({
    id: cb.value,
    name: cb.getAttribute("data-name")
  }));

  setStatus("Queueing test classes in Salesforce Test Execution...", "");
  closeTestModal();

  try {
    // Queue tests via Salesforce Tooling API (async so runs appear in org Test Execution)
    const queuedRunIds = [];
    for (const testClass of selectedTestClassIds) {
      const result = await runTestClass(currentConfig, testClass.id, testClass.name);
      if (result && result.runId) {
        queuedRunIds.push(result.runId);
      }
    }

    await openApexTestQueuePage(currentConfig.instanceUrl);

    const queuedText = queuedRunIds.length > 0
      ? ` Run IDs: ${queuedRunIds.join(", ")}.`
      : "";
    setStatus(
      `Queued ${selectedTestClassIds.length} test class(es) in Salesforce.${queuedText} ` +
        "Apex Test Queue opened. After test execution completes, reload coverage to see updated results.",
      "success"
    );
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
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

async function openApexTestQueuePage(instanceUrl) {
  const queueUrl = buildApexTestQueueUrl(instanceUrl);
  await chrome.tabs.create({ url: queueUrl });
}

function buildApexTestQueueUrl(instanceUrl) {
  let baseUrl = String(instanceUrl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Missing Salesforce instance URL.");
  }

  // Lightning setup pages are served from the lightning.force.com host.
  baseUrl = baseUrl.replace(/\.my\.salesforce\.com$/i, ".lightning.force.com");
  return `${baseUrl}/lightning/setup/ApexTestQueue/home`;
}
