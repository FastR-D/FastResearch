# Vendored Task-owned today fixture

Source: FastR-D/FastTask `contracts/fastresearch-today/v1/cases.json`.
This local copy supports a clean single-repository test run. Upgrade it together
with the receiver-owned contract; it is not a separately authored protocol.
The shared fixture describes the real today endpoint only. Research's historical
tasks/progress/account methods remain reserved against Task main 8e91d76.

`npm test` exercises the production today factory and installed registry SDK.
`node scripts/fasttask-today-contract.mjs` requires an explicitly configured local
test receiver and issuer, and asserts both service and legacy paths. The Task
wire test can launch that probe with a disposable signed issuer and real Task
HTTP server. The probe also starts Research's actual server with only service
credentials, logs in a local Key member, and calls its workspace today route
twice. It asserts received=true, the full nonempty three-item projection,
completion/progress counts, plan metadata and workspace links against
`research_today`. The direct client also checks the known and unknown receivers'
entire wire responses. Task seeds actual account mappings and domain rows;
`$today` is the current UTC date, not a product configuration option.
Task checks that the production client reuses its token. It must never
target production.
