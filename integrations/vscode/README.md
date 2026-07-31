# PCS VS Code / Cursor adapter

This is a local read-only extension. It requests only a selected PCS profile.
Set `PCS_CLIENT_ID` and `PCS_CLIENT_TOKEN` in the extension host environment,
then run `PCS: Load Scoped Context`. Cursor can use the same VS Code extension
package. It never writes PCS data.
