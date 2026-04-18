# Apex Class Coverage Viewer - Architecture and API Logic

This document explains the end-to-end architecture of the Chrome extension, the runtime flow, and all APIs used (Chrome APIs + Salesforce APIs). It also includes Metadata API notes and examples.

## 1) High-Level Architecture

The extension has three core runtime parts:

- `background.js`
  - Handles extension icon click.
  - Opens `popup.html` in a new window.
  - Passes clicked tab context (`sourceTabId`) to the UI.

- `popup.html` + `styles.css`
  - UI shell (controls, summary cards, tables, modals, header/footer).
  - Theme support (Light/Dark).
  - Collapsible sections:
    - Apex Classes
    - Method Coverage
    - Test Class Execution Result

- `popup.js`
  - Main controller and business logic.
  - Session resolution from the clicked Salesforce tab.
  - Salesforce data loading and rendering.
  - Test execution + queue monitoring.
  - Class source viewer with line-level coverage coloring.

## 2) Runtime Flow

### 2.1 Extension Launch Flow

1. User clicks extension icon on a Salesforce tab.
2. `background.js` opens extension window (`popup.html`) and passes `sourceTabId`.
3. `popup.js` starts initialization:
   - restore UI preferences from `chrome.storage.local`
   - apply theme
   - import Salesforce session from clicked tab
   - wire all UI listeners

### 2.2 Coverage Load Flow

1. User clicks **Load Coverage**.
2. Extension validates `instanceUrl`, `accessToken`, `apiVersion`.
3. Tooling API queries:
   - `ApexClass`
   - `ApexCodeCoverageAggregate`
4. Data is transformed into class rows and rendered.
5. Summary panel computes:
   - classes
   - covered lines
   - uncovered lines
   - overall coverage %
6. Method/Test sections are controlled by section collapse logic.

### 2.3 Test Execution Flow

1. User selects test classes in modal and clicks **Execute Selected**.
2. Extension enqueues async test runs via Tooling `runTestsAsynchronous`.
3. Polls `ApexTestQueueItem` until all selected test classes finish.
4. Loads failed method details from `ApexTestResult`.
5. Refreshes coverage after completion (pass or fail).

### 2.4 Class Code Viewer Flow

1. User clicks `View` in a class row.
2. Extension fetches class source and line-level coverage.
3. Opens modal with VS Code-like viewer:
   - full class source shown
   - covered lines green
   - uncovered lines red
   - sticky line numbers

## 3) State and Persistence

Stored in `chrome.storage.local` (`STORAGE_KEY = "apexCoverageConfig"`):

- `includeMethodDetails`
- `excludePackages`
- `theme` (`light` or `dark`)

Important behavior:

- Light theme is default for first run.
- Session token/instance values are not kept as "sticky org state"; session is resolved from clicked tab context.

## 4) Chrome APIs Used

- `chrome.action.onClicked`
  - capture extension icon click + source tab context.

- `chrome.windows.create`
  - open extension UI in a new popup window.

- `chrome.tabs.get`, `chrome.tabs.query`
  - find clicked tab / fallback Salesforce tabs.

- `chrome.cookies.get`, `chrome.cookies.getAll`
  - read Salesforce `sid` cookie from correct domain.

- `chrome.storage.local.get`, `chrome.storage.local.set`
  - persist user preferences (theme, toggles).

## 5) Salesforce APIs Used

The extension primarily uses Salesforce REST + Tooling REST endpoints.

### 5.1 Version Discovery

- `GET /services/data/`
- Purpose: detect latest REST API version.

Example:

```bash
curl -H "Authorization: Bearer <token>" \
  https://your-org.my.salesforce.com/services/data/
```

### 5.2 Tooling SOQL Query (generic pagination path)

- `GET /services/data/vXX.X/tooling/query?q=<SOQL>`
- Used by `queryAll()` to fetch paginated records (`nextRecordsUrl`).

Objects queried:

- `ApexClass`
- `ApexCodeCoverageAggregate`
- `ApexCodeCoverage`
- `ApexTestQueueItem`
- `ApexTestResult`

Example:

```bash
curl -H "Authorization: Bearer <token>" \
  "https://your-org.my.salesforce.com/services/data/v60.0/tooling/query?q=SELECT+Id,Name+FROM+ApexClass+LIMIT+10"
```

### 5.3 Direct Tooling sObject Fetch

- `GET /services/data/vXX.X/tooling/sobjects/ApexClass/<classId>`
- Purpose: get full Apex class body for line viewer.

Example:

```bash
curl -H "Authorization: Bearer <token>" \
  https://your-org.my.salesforce.com/services/data/v60.0/tooling/sobjects/ApexClass/01pXXXXXXXXXXXX
```

### 5.4 Async Test Execution

- `POST /services/data/vXX.X/tooling/runTestsAsynchronous`
- `GET  /services/data/vXX.X/tooling/runTestsAsynchronous/?classids=<id>` (fallback mode)

Used payload variations:

- `{ "classids": "<ApexClassId>" }`
- `{ "classNames": "<TestClassName>" }`
- `{ "tests": [{ "className": "<TestClassName>" }] }`

Example:

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"classids":"01pXXXXXXXXXXXX"}' \
  https://your-org.my.salesforce.com/services/data/v60.0/tooling/runTestsAsynchronous
```

### 5.5 Standard REST Query (non-tooling)

- `GET /services/data/vXX.X/query?q=<SOQL>`
- Used for org/environment metadata via `Organization` object.

Example:

```bash
curl -H "Authorization: Bearer <token>" \
  "https://your-org.my.salesforce.com/services/data/v60.0/query?q=SELECT+Name,IsSandbox,InstanceName+FROM+Organization+LIMIT+1"
```

### 5.6 Chatter REST

- `GET /services/data/vXX.X/chatter/users/me`
- Purpose: get logged-in user display name for header bar.

Example:

```bash
curl -H "Authorization: Bearer <token>" \
  https://your-org.my.salesforce.com/services/data/v60.0/chatter/users/me
```

## 6) Metadata API Notes

Current implementation does not execute Metadata API SOAP calls for coverage logic. Coverage/test/class details are handled by Tooling API + REST.

Metadata API is typically used for retrieval/deploy operations (package-level metadata), not runtime code coverage reads.

If you want to add Metadata API support later (for example, retrieve `ApexClass` metadata package), use:

- SOAP endpoint pattern:
  - `https://your-org.my.salesforce.com/services/Soap/m/<version>`

Example Metadata API retrieve request (conceptual SOAP skeleton):

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata">
  <soapenv:Header>
    <met:SessionHeader>
      <met:sessionId>YOUR_SESSION_ID</met:sessionId>
    </met:SessionHeader>
  </soapenv:Header>
  <soapenv:Body>
    <met:retrieve>
      <met:retrieveRequest>
        <met:apiVersion>60.0</met:apiVersion>
        <met:singlePackage>true</met:singlePackage>
        <!-- package.xml zip manifest reference -->
      </met:retrieveRequest>
    </met:retrieve>
  </soapenv:Body>
</soapenv:Envelope>
```

## 7) UI Component Responsibilities

- Header bar
  - user name
  - org environment
  - theme dropdown

- Action card
  - load coverage
  - execute tests
  - export CSV
  - method/package toggles

- Summary card
  - classes
  - total lines
  - covered/uncovered
  - overall %

- Collapsible data sections
  - Apex Classes
  - Method Coverage
  - Test Execution Result

- Class Coverage modal
  - full source code
  - line-level covered/uncovered highlighting

## 8) Error Handling Strategy

- Salesforce API response errors are normalized by `extractSalesforceError()`.
- Network/parse errors fallback to safe user messages via `getErrorMessage()`.
- Test execution polling has timeout protection.
- Session import has fallback cookie matching logic for multi-domain org URLs.

## 9) Security and Privacy Design

- Session is read from browser cookies (`sid`) on Salesforce domain context.
- No external third-party backend is used for processing.
- Preference-only storage in `chrome.storage.local`.
- Links in footer open with `rel="noopener noreferrer"`.

---

If needed, this file can be extended with sequence diagrams and API response samples for each endpoint.
