const form = document.getElementById("config-form");
const loadButton = document.getElementById("load-button");
const sessionButton = document.getElementById("session-button");
const exportButton = document.getElementById("export-button");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const tableWrapperEl = document.getElementById("table-wrapper");
const coverageBodyEl = document.getElementById("coverage-body");
const searchEl = document.getElementById("search");
const searchLabelEl = document.getElementById("search-label");
const includeMethodDetailsEl = document.getElementById("include-method-details");
const methodDetailsSectionEl = document.getElementById("method-details");
const methodDetailsTitleEl = document.getElementById("method-details-title");
const methodDetailsHelpEl = document.getElementById("method-details-help");
const methodDetailsBodyEl = document.getElementById("method-details-body");

let allRows = [];
let visibleRows = [];
let selectedClassId = null;
let currentConfig = null;
const methodCoverageCache = new Map();

const STORAGE_KEY = "apexCoverageConfig";

initialize();

function initialize() {
  restoreConfig();
  fillSessionFromActiveTab(); // Auto-load session on startup

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadCoverage();
  });

  sessionButton.addEventListener("click", async () => {
    await fillSessionFromActiveTab();
  });

  exportButton.addEventListener("click", () => {
    exportVisibleRowsToCsv();
  });

  includeMethodDetailsEl.addEventListener("click", async (event) => {
    event.preventDefault();
    toggleMethodDetailsView();
    await handleMethodViewToggle();
  });

  searchEl.addEventListener("input", () => {
    visibleRows = filterRows(allRows, searchEl.value);
    renderRows(visibleRows);
  });
}

function toggleMethodDetailsView() {
  const isPressed = includeMethodDetailsEl.getAttribute("aria-pressed") === "true";
  includeMethodDetailsEl.setAttribute("aria-pressed", !isPressed);
}

async function restoreConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const config = stored[STORAGE_KEY];

  if (!config) {
    return;
  }

  form.instanceUrl.value = config.instanceUrl || "";
  form.accessToken.value = config.accessToken || "";
  form.apiVersion.value = config.apiVersion || "60.0";
  includeMethodDetailsEl.setAttribute("aria-pressed", Boolean(config.includeMethodDetails));
}

async function persistConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

async function loadCoverage() {
  const config = {
    instanceUrl: (form.instanceUrl.value || "").trim().replace(/\/+$/, ""),
    accessToken: (form.accessToken.value || "").trim(),
    apiVersion: (form.apiVersion.value || "").trim(),
    includeMethodDetails: includeMethodDetailsEl.getAttribute("aria-pressed") === "true"
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

    allRows = buildCoverageRows(classes, coverage);
    visibleRows = allRows.slice();
    renderRows(visibleRows);
    renderSummary(allRows);
    toggleResults(true);
    await handleMethodViewToggle();
    setStatus(`Loaded ${allRows.length} Apex classes.`, "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    setLoading(false);
  }
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

function filterRows(rows, term) {
  const normalized = (term || "").trim().toLowerCase();
  if (!normalized) {
    return rows;
  }

  return rows.filter((row) => row.name.toLowerCase().includes(normalized));
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
  methodDetailsSectionEl.classList.toggle("hidden", true);
}

function setLoading(isLoading) {
  loadButton.disabled = isLoading;
  sessionButton.disabled = isLoading;
  exportButton.disabled = isLoading;
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
  setStatus("Reading session from active Salesforce tab...", "");

  try {
    const tab = await getActiveTab();
    if (!tab || !tab.url) {
      throw new Error("No active browser tab found.");
    }

    const tabUrl = new URL(tab.url);
    if (!isSalesforceHost(tabUrl.hostname)) {
      throw new Error("Active tab is not a Salesforce domain.");
    }

    const sidCookie = await chrome.cookies.get({
      url: tabUrl.origin,
      name: "sid"
    });

    if (!sidCookie || !sidCookie.value) {
      throw new Error("No Salesforce sid cookie found in the active tab.");
    }

    form.instanceUrl.value = tabUrl.origin;
    form.accessToken.value = sidCookie.value;

    // Auto-detect API version from Salesforce
    const apiVersion = await detectApiVersion(tabUrl.origin, sidCookie.value);
    form.apiVersion.value = apiVersion;

    await persistConfig({
      instanceUrl: form.instanceUrl.value,
      accessToken: form.accessToken.value,
      apiVersion: form.apiVersion.value
    });

    setStatus("Session imported from active Salesforce tab.", "success");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  }
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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tabs[0] || null;
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
