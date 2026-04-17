# Apex Class Coverage Viewer (Chrome Extension)

This extension connects to Salesforce Tooling API and shows:

- All Apex classes
- Covered and uncovered lines per class
- Coverage percentage per class
- Overall org-level coverage summary

## Files

- `manifest.json` - Extension metadata and permissions
- `popup.html` - Popup user interface
- `styles.css` - Popup styles
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

1. Click the extension icon
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

The extension queries:

- `ApexClass`
- `ApexCodeCoverageAggregate`

and combines the results in a table.

## Notes

- The token is stored in Chrome local extension storage for convenience.
- Session import reads Salesforce `sid` from the active tab cookie.
- If you run into auth issues, refresh your OAuth token and try again.


app link: https://chromewebstore.google.com/detail/apex-class-coverage-viewe/hdakkklbpcmnnghmipiimphgcfccabng
