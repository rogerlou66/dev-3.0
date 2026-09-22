Short: Artifact scripts using createObjectURL run again

The artifact viewer's CSS `url()` asset rewrite matched case-insensitively inside JavaScript identifiers and always emitted lowercase, so a report calling `URL.createObjectURL(...)` was rewritten to `createObjecturl` and failed to start. The rewrite now only touches a standalone `url(` token, keeps its original casing, and leaves any value that is not a copied asset byte-exact.
