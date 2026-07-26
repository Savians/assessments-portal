export const agreementDownloadRedirect = (url: string) => ({
  statusCode: 302,
  headers: {
    location: url,
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff"
  }
});
