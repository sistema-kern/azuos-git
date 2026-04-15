/** Returns { "x-tenant-id": id } when ?tenantId=X is present in the URL, otherwise {} */
export function getTenantHeaders(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const tenantId = params.get("tenantId");
  return tenantId ? { "x-tenant-id": tenantId } : {};
}
