/*
 * Boilerplate Workfront App Builder Runtime action.
 * Companion to the `workfront-actions` skill. CommonJS only (exports.main).
 *
 * Contract: always return { data, error } in the body; the SPA checks `error` first.
 * Secrets/config arrive as params (wired via .env -> action `inputs` in config).
 * NEVER read process.env at runtime — it is empty once deployed.
 * The SPA forwards imsToken + the Workfront instance URL; never hardcode them.
 */
async function main (params) {
  try {
    // 1. Validate inputs the SPA must pass.
    const { imsToken, workFrontInstanceUrl } = params
    if (!imsToken || !workFrontInstanceUrl) {
      return { statusCode: 400, body: { data: null, error: 'missing parameter(s): imsToken, workFrontInstanceUrl' } }
    }

    // Guard the org id: reject the literal strings that leak in from an empty SPA value,
    // or Fetch will forward "undefined" and Workfront returns 401 "Org Id undefined ...".
    const imsOrgId = params.imsOrgId
    const orgHeader = (imsOrgId && !['undefined', 'null'].includes(String(imsOrgId))) ? { 'x-gw-ims-org-id': imsOrgId } : {}

    // 2. Call the PUBLIC REST endpoint from the action (never from the browser).
    //    Workfront Public API is v21.0: {instance}/attask/api/v21.0{path}
    const res = await fetch(`${workFrontInstanceUrl}/attask/api/v21.0/project/search?fields=name`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${imsToken}`, // never log this
        'Content-Type': 'application/json',
        ...orgHeader
      }
    })

    if (!res.ok) {
      return { statusCode: res.status, body: { data: null, error: `Workfront API ${res.status}` } }
    }

    const json = await res.json()
    // 3. Map into { data, error }.
    return { statusCode: 200, body: { data: json.data, error: null } }
  } catch (e) {
    return { statusCode: 500, body: { data: null, error: e.message } }
  }
}

exports.main = main
