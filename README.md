# CATS SpendPass

Give an agent one finite native test-MON budget, let it buy fixed task-acceptance fees from two operators, and independently recover money that no operator accepted.

This is a Monad testnet prototype. It has not been audited and is not production payment software.

## What payment proves

An `Accepted` transaction transfers an irrevocable task-acceptance fee to the fixed payee. It proves neither that a model started nor that a service was delivered. The operator can fail, stop, or never dispatch while keeping the accepted fee. Closing a workflow returns only unaccepted free money; accepted fees remain independently claimable.

One root has one lifetime offer and at most one split into two leaves. A 0.010 test-MON budget allows A at most 0.002 and two B leaves at most 0.004 each. There is no unlimited recursion, replenishment, replacement offer or withdrawal of accepted fees. Gas is paid separately.

## Evidence and limitations

The initial real-provider request passed the actual Monad receipt and matching WS `Verified` gate, then returned **HTTP 401**. Exactly one request was attempted. Its durable state is **Failed**, and the permanent attempt guard is preserved. It is not a successful AI response. Its terminal task state and permanent attempt guard prevent an automatic retry.

Separate A/B fixture runs use deterministic synthetic responses and **zero real-model HTTP calls**. The UI and evidence identify them as fixtures. An early fixture A was paid but undispatched after the old timing start included RPC preparation; that task is retained and is not retried. Financial followup and cold recovery have separate journals. The later actual-chain financial resume reached an active tree with B Completed using a synthetic response; its exact transport broadcast-to-observed-Verified sample is 2.043 seconds. The original A remains PaidUndispatched. This is one observed sample, not a latency distribution. The two-leaf financial demonstration and the successful real-model demonstration are separate workflows, rather than a continuous same-root real-model fanout.

A later restricted-key test succeeded on a **new root**. One real model POST returned 22 prompt tokens and 15 completion tokens; the backend recorded one billable activity entry and USD 0.00000738. The requested route was `deepseek-v4-flash`; the response reported `deepseek-flash`, which is disclosed rather than treated as cryptographic model-identity proof. The key was revoked, its subsequent authentication returned 401, and its local file was deleted. The same new root closed and its accepted 0.002 test-MON fee was claimed; native and accounted contract balances were zero after recovery. Total gas for this new-root flow was 0.085859928 test MON. Its exact broadcast-to-observed-Verified sample was 2.032 seconds. The two authentication uses were a GET key probe plus a model POST, not two model requests. The old Failed task and permanent guard remain unchanged. The adapter limits input to the approved short ASCII request, model, output limit 160, disabled thinking and disabled fallback. The runner revokes the dedicated temporary key immediately after the call and again in its cleanup path. The worker reads only that restricted key.

The final real-call runner signs locally using a fixed nonce, chain ID and gas settings; signed raw transaction files remain in private storage. It records preparation start and `rawReadyAt`, then the timing helper records the actual `eth_sendRawTransaction` invocation. The five-second admission gate uses broadcast-to-observed-WS-Verified time. It does not substitute receipt time or RPC completion time. Older samples recorded before `writeContract` include internal preparation and are not exact broadcast latency; no p95 or TPS claim is made.

The read-only audit of nine initial live/recovery transaction hashes reports **0.30944964 test MON** in network fees. Fees use transaction gas limit multiplied by receipt effective gas price, as required by [Monad's official pricing documentation](https://docs.monad.xyz/developer-essentials/gas-pricing). In those transactions the previously stored gas-used fees happen to equal gas-limit fees; missing funding fees were additionally recovered. The 0.5 test-MON principal transferred to fund operator wallets is separate from these network fees. Original journals remain unchanged. The audit does not newly verify historical wallet balance deltas.

## Reproduce local checks

Node.js 20 or newer and Foundry with Solidity 0.8.28 are required. From this directory:

```sh
npm ci
npm test
forge test
```

The current source has 77 passing Node tests and 31 passing Solidity tests (including 256 fuzz runs); the independent worker HTTP-counter probe has ten cases. Node tests use deterministic chain fixtures and loopback HTTP. They do not spend testnet funds or use a real provider. Foundry checks contract conservation, caps, quote replay, closing races, irreversible acceptance, transfer rollback and reentrancy. The known-bad conservation case intentionally fails its standalone guard; it is recorded separately from passing tests.

Copy `web/deployment.example.json` to `web/deployment.json` and replace its disabled placeholders before serving the UI. To rebuild the standalone web bundle, copy the compiled SpendPass ABI into `web/abi.json` and explicitly save the deployment address, bytecode hash, owner, root ID, RPC and chain ID. Serve the main UI and recovery page on separate origins. Recovery must use saved static configuration and RPC after the gateway stops. A loopback test-wallet bridge is a controlled test EOA transport, not an installed wallet extension.

## Explicit configuration

`sample.env` contains placeholders only and is rejected as a working configuration. Load project variables deliberately. Wallet and quota files must be private regular files readable only by their owner. This package contains no private key, API key or user wallet file. Public scalar values in tests are explicitly labelled unfunded fixtures.

- `SPENDPASS_WALLETS_FILE`: protected testnet wallet JSON for explicitly authorized signing scripts.
- `SPENDPASS_CONTEXT_FILE`: saved deployment context for the intended workflow.
- `SPENDPASS_RUNTIME_DIRECTORY`: existing per-operator persistent state directory; A and B use distinct directories/processes.
- `SPENDPASS_QUOTA_ENV_FILE`, `SPENDPASS_QUOTA_KEY_NAME`, `SPENDPASS_PROVIDER_URL`: protected provider configuration. No default provider call is enabled.
- `SPENDPASS_ATTEMPT_GUARD`: **the existing permanent real-call guard**, never a fresh substitute. An existing guard stops real A before credentials are read.
- `SPENDPASS_FIXTURE_A=1`: synthetic A response; reads no quota/key or attempt guard and sends no provider HTTP. B is also explicitly synthetic.

Signing/deployment/recovery scripts can transfer test MON when invoked; `npm test` excludes them. Ambiguous outcomes are journalled and never automatically rebroadcast. Local loopback demonstrations need no legacy gateway source. For an external provider, configure `jsonHttpProvider` with the provider's accepted JSON body and sign the quote over those exact bytes; the restricted one-shot adapter adds its specific routing and output bounds.

## Architecture

`contracts/src/SpendPass.sol` owns native-MON escrow and immutable root policy. Each grant has a separate ledger; delegated allocation history is not double-counted as spendable assets. `runtime/worker.mjs` gates dispatch on a fresh matching accept receipt, exact WS Verified proposal/hash, pinned Accepted state, fixed payee and immutable fee entitlement. Already claimed acceptance fees remain valid paid entitlement.

A worker's durable identity is chain ID plus deployment contract plus grant ID. A caller-chosen job label cannot produce another dispatch. The signed quote binds the exact canonical JSON provider body, model label and root policy. Changed prompts, models, domains, payees, fees, receipt targets or quote hashes fail closed. Dispatch intent is persisted before HTTP; Unknown is never automatically retried. A Completed label requires a persisted response with usage, with fixture responses separately identified.

## Foundation and AI-tool disclosure

This candidate implements a new bounded SpendPass module, fixed acceptance-fee quotes, two isolated workers, a Monad WS-confirmation adapter, native-MON tree accounting and independent recovery flow. Earlier SafeRouter work informed finite-budget and independent-recovery ideas; an existing authorized Sumplus provider quota/backend was attempted. The standalone source implements these components without requiring the earlier gateway code.

Codex assisted engineering, tests and documentation. Grok assisted design review. Simulated operators are not customer traction. This work makes no mainnet, production TEE, audited-security, model-identity, quality or measured parallel-TPS claim.

The initial execution used ws 8.18.3. The final candidate pins ws 8.21.0 directly and overrides transitive ws, retaining the historical package-lock hash separately. The repaired package passes the same 77 Node tests, 31 Foundry tests and a read-only live WS/contract check; npm audit reports zero known vulnerabilities at preparation time. This does not relabel historical chain/model evidence as having run under the newer dependency.

Project-authored candidate code is prepared under MIT. Dependency and vendored-library rights remain with their respective authors; see `THIRD_PARTY_LICENSES/` and the pinned package lock. The candidate contains no personal Git metadata.
