# Apex Class Coverage Viewer (Chrome Extension)

This extension connects to Salesforce Tooling API and shows:

- All Apex classes
- Covered and uncovered lines per class
- Coverage percentage per class
- Overall org-level coverage summary

## Files

- `manifest.json` - Extension metadata and permissions
- `background.js` - Opens the extension UI in a new window
- `popup.html` - Extension user interface page
- `styles.css` - Extension UI styles
- `popup.js` - Salesforce API integration and rendering logic

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `chromeextension`

## Create publish ZIP

Run:

`./scripts/package-extension.sh`

What it does:

- Verifies `manifest.json` uses PNG icon paths (not SVG)
- Ensures icon dimensions are exactly 16x16, 48x48, and 128x128
- Includes only required extension files (so `.DS_Store` is excluded from upload)
- Creates a clean upload ZIP in `dist/` named with the manifest version

## How to use

1. Click the extension icon (opens the extension UI in a new maximized window)
2. Optional: open any logged-in Salesforce tab and click **Use Logged-in Tab Session** to auto-fill URL and token
3. Or enter manually:
   - **Salesforce Instance URL**  
     Example: `https://your-domain.my.salesforce.com`
   - **Access Token**  
     OAuth bearer token with API access
   - **API Version**  
     Example: `60.0`
4. Click **Load Coverage**
5. (Optional) use **Export CSV** to download currently visible rows (respects filter)
6. Turn on **Method-wise view** to switch from class-wise mode and click a class row to see which test methods covered each Apex method
7. (Optional) **Generate Test (AI)** for the selected class - drafts an Apex test via your configured AI provider and saves it as a new test class or appends into an existing one (see "AI Test Generation" below)

## AI Test Generation

Click the gear icon in the header to choose a provider for AI-assisted test class generation:

- **Salesforce Einstein LLM Generations** - reuses your active Salesforce session (Einstein GPT must be enabled in the org)
- **Salesforce Models REST API** - org-managed multi-model endpoint
- **Agentforce Agent** - send the prompt to a configured Agent (provide the Agent ID)
- **OpenAI** - bring-your-own API key, called directly from the extension
- **Anthropic Claude** - bring-your-own API key, called directly from the extension

Then:

1. Load coverage and click any class row to select it
2. Click **Generate Test (AI)**
3. Pick **Create new test class** or **Append into existing test class**
4. Optionally add hints (e.g. "cover bulk update with 200 records", "use @TestSetup")
5. Click **Generate**, review (and edit) the produced Apex code
6. Click **Save to Org**:
   - New class is saved via Tooling `ApexClass` POST
   - Append uses the standard `MetadataContainer` + `ApexClassMember` + `ContainerAsyncRequest` flow (works in production and sandbox)
7. Optionally queue the new/updated class for execution and auto-refresh coverage

API keys are stored only on this device via `chrome.storage.local` and never sent to Salesforce.

The extension queries:

- `ApexClass`
- `ApexCodeCoverageAggregate`

and combines the results in a table.

## Notes

- The token is stored in Chrome local extension storage for convenience.
- Session import reads Salesforce `sid` from the most recently active Salesforce tab cookie.
- If you run into auth issues, refresh your OAuth token and try again.


app link: https://chromewebstore.google.com/detail/apex-class-coverage-viewe/hdakkklbpcmnnghmipiimphgcfccabng
