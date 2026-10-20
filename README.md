# LinkedIn Word Filter for Firefox

Hide LinkedIn feed posts that do not contain the words or phrases you choose. Matching is case insensitive and uses word boundaries: `AI` matches “AI research” but not “paid.” Enter one term per line or separate terms with commas. A blank list shows all posts.

Filtering happens entirely in Firefox. The extension sends no data anywhere and asks only for LinkedIn page access and local storage. See [PRIVACY.md](PRIVACY.md).

## Use

1. Install the add-on in Firefox, then open LinkedIn's feed.
2. Click the extension button, enter words or phrases, and click **Save filters**.
3. Turn off **Enable filtering** to show all posts at once.

The extension checks post body text, including newly loaded posts. It does not inspect comments or messages. LinkedIn can change its page markup, so filtering may need updates. It runs only on `www.linkedin.com` feed pages.

For smoother scrolling, it checks posts near the viewport and applies visibility changes together once per frame. Matching posts briefly fade in; reduced motion settings disable the fade. Posts farther down the feed are checked as you scroll toward them; the popup's hidden count increases as you move through the feed.

## Troubleshooting

After saving filters, the popup reports how many feed posts LinkedIn loaded and how many the extension has hidden so far. If it says **Not connected**, check the extension's permission for `www.linkedin.com` in `about:addons`, then refresh the LinkedIn tab. If it says **No feed posts detected**, check that you are on `https://www.linkedin.com/feed/` and reload the page.

For script errors, open Firefox Developer Tools on the LinkedIn tab (macOS: **Cmd+Option+K**; Windows/Linux: **Ctrl+Shift+K**) and select **Console**. Search for `LinkedIn Word Filter`. Popup errors appear under **Inspect** next to the extension on `about:debugging#/runtime/this-firefox`. After changing source files, click **Reload** there and refresh LinkedIn.

## Develop and test

Requirements: Node.js 20+ and npm.

```sh
npm ci
npm test
npm run pack:extension
npx web-ext lint --source-dir . --ignore-files test scripts node_modules dist README.md PRIVACY.md LICENSE package.json package-lock.json .gitignore
```

For a temporary local install, open `about:debugging#/runtime/this-firefox` in Firefox, choose **Load Temporary Add-on**, and select `manifest.json`. Temporary add-ons disappear when Firefox restarts. A release install requires [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

The ZIP under `dist/` contains only runtime extension files and is suitable for submission to the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/). Choose a listed add-on, upload the ZIP, and state that the add-on collects no data. Mozilla's review and signing determine when it becomes installable in release Firefox.

## License

MIT. This independent project is not affiliated with LinkedIn or Mozilla.
