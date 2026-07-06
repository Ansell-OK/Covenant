;; covenant-splitter.clar
;; Pull-model multi-recipient USDCx splitter for use as a FlowVault splitAddress target.
;; Registry (recipients + shares) is editable by the admin (the original deployer),
;; but ONLY when the contract's live USDCx balance is zero - this prevents changing
;; shares while USDCx is already owed to recipients under the previous configuration.
;; Claim history (claimed-by-recipient, total-ever-claimed) persists across registry
;; changes for transparency/auditability - it is never reset.
;; Compatible with Clarity 3 / Epoch 3.4+ (matches real deployed USDCx/FlowVault version).

(use-trait sip-010-trait 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.sip-010-trait-ft-standard.sip-010-trait)
;; NOTE: this address is the SIMNET default deployer, confirmed from `clarinet check`
;; deployment plan output during local testing. This MUST be changed before real
;; testnet/mainnet deployment to point at wherever the real sip-010-trait definition
;; USDCx was compiled against actually lives - verify via the contract's ABI before
;; deploying, do not assume this address carries over.

(define-constant MAX_RECIPIENTS u5)

;; -- Constants: token contract this splitter is bound to ---------------------
(define-constant USDCX_CONTRACT 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx)

;; -- Admin: fixed at deploy time, never changes -------------------------------
(define-constant ADMIN tx-sender)

;; -- Errors --------------------------------------------------------------------
(define-constant ERR_NOT_A_RECIPIENT (err u100))
(define-constant ERR_ZERO_CLAIMABLE  (err u101))
(define-constant ERR_INVALID_SHARE_SUM (err u103))
(define-constant ERR_TRANSFER_FAILED  (err u104))
(define-constant ERR_WRONG_TOKEN_CONTRACT (err u106))
(define-constant ERR_NOT_ADMIN (err u107))
(define-constant ERR_BALANCE_NOT_ZERO (err u108))
(define-constant ERR_TOO_MANY_RECIPIENTS (err u109))
(define-constant ERR_EMPTY_REGISTRY (err u110))

;; -- State: registry -------------------------------------------------------------
;; recipient-shares: principal -> bps, only present for currently-active recipients.
;; recipient-count: how many slots are currently active (0 to MAX_RECIPIENTS).
;; recipient-list: index -> principal, used so set-registry can clear stale slots
;; from a previous, larger registry when the new one is smaller.
(define-map recipient-shares principal uint)
(define-map recipient-list uint principal)
(define-data-var recipient-count uint u0)

;; -- State: claim history, persists across registry changes ----------------------
(define-map claimed-by-recipient principal uint)
(define-data-var total-ever-claimed uint u0)

;; -- Read-only helpers -------------------------------------------------------------
(define-read-only (get-recipient-bps (who principal))
  (default-to u0 (map-get? recipient-shares who)))

(define-read-only (get-recipient-count)
  (var-get recipient-count))

(define-read-only (get-recipient-at (index uint))
  (map-get? recipient-list index))

(define-read-only (get-total-ever-claimed)
  (var-get total-ever-claimed))

(define-read-only (get-claimed-by (who principal))
  (default-to u0 (map-get? claimed-by-recipient who)))

(define-read-only (get-admin)
  ADMIN)

;; -- Public: get-claimable-amount --------------------------------------------------
;; define-public, not define-read-only: calls contract-call? internally (to read the
;; USDCx contract's balance), which Clarity disallows inside define-read-only.
;; Frontend/tests should invoke this the same way as claim() - as a public function
;; call, not a true read-only call.
(define-public (get-claimable-amount (who principal) (token <sip-010-trait>))
  (let (
    (balance      (unwrap! (contract-call? token get-balance (as-contract tx-sender)) ERR_TRANSFER_FAILED))
    (ever-claimed (var-get total-ever-claimed))
    (lifetime     (+ balance ever-claimed))
    (share-bps    (get-recipient-bps who))
    (already      (default-to u0 (map-get? claimed-by-recipient who)))
    (entitled     (/ (* lifetime share-bps) u10000))
  )
    (ok (if (> entitled already) (- entitled already) u0))))

;; -- Public: claim -------------------------------------------------------------
(define-public (claim (token <sip-010-trait>))
  (let (
    (claimer      tx-sender)
    (balance      (unwrap! (contract-call? token get-balance (as-contract tx-sender)) ERR_TRANSFER_FAILED))
    (ever-claimed (var-get total-ever-claimed))
    (lifetime     (+ balance ever-claimed))
    (share-bps    (get-recipient-bps claimer))
    (already      (default-to u0 (map-get? claimed-by-recipient claimer)))
    (entitled     (/ (* lifetime share-bps) u10000))
    (amount       (if (> entitled already) (- entitled already) u0))
  )
    (asserts! (is-eq (contract-of token) USDCX_CONTRACT) ERR_WRONG_TOKEN_CONTRACT)
    (asserts! (> share-bps u0) ERR_NOT_A_RECIPIENT)
    (asserts! (> amount u0)    ERR_ZERO_CLAIMABLE)
    (match (as-contract (contract-call? token transfer amount tx-sender claimer none))
      success
        (begin
          (map-set claimed-by-recipient claimer (+ already amount))
          (var-set total-ever-claimed (+ ever-claimed amount))
          (ok amount))
      error ERR_TRANSFER_FAILED)))

(define-public (debug-claim-inputs (who principal) (token <sip-010-trait>))
  (let (
    (balance      (unwrap! (contract-call? token get-balance (as-contract tx-sender)) ERR_TRANSFER_FAILED))
    (ever-claimed (var-get total-ever-claimed))
    (lifetime     (+ balance ever-claimed))
    (share-bps    (get-recipient-bps who))
    (already      (default-to u0 (map-get? claimed-by-recipient who)))
    (entitled     (/ (* lifetime share-bps) u10000))
    (amount       (if (> entitled already) (- entitled already) u0))
  )
    (ok {
      balance: balance,
      ever-claimed: ever-claimed,
      lifetime: lifetime,
      share-bps: share-bps,
      already: already,
      entitled: entitled,
      amount: amount
    })))

;; -- Private helper: clear a single recipient-list slot and its share ------------
(define-private (clear-slot (index uint))
  (match (map-get? recipient-list index)
    principal-to-clear
      (begin
        (map-delete recipient-shares principal-to-clear)
        (map-delete recipient-list index)
        true)
    true))

;; -- Private helper: extract bps from an entry, for summing -----------------------
(define-private (get-bps-of (entry {recipient: principal, bps: uint}))
  (get bps entry))

;; -- Private helper: write one new registry entry, threading the next index -------
(define-private (write-entry (entry {recipient: principal, bps: uint}) (index uint))
  (begin
    (map-set recipient-list index (get recipient entry))
    (map-set recipient-shares (get recipient entry) (get bps entry))
    (+ index u1)))

;; -- Public: set-registry --------------------------------------------------------
;; Admin-only. Only callable when the contract's live USDCx balance is exactly zero,
;; preventing a share change while USDCx is already owed under the previous config.
;; Replaces the entire registry: clears all previously-active slots first, then
;; writes the new list. Claim history is NOT reset - it persists for transparency.
(define-public (set-registry (new-entries (list 5 {recipient: principal, bps: uint})) (token <sip-010-trait>))
  (let (
    (balance    (unwrap! (contract-call? token get-balance (as-contract tx-sender)) ERR_TRANSFER_FAILED))
    (new-count  (len new-entries))
    (total-bps  (fold + (map get-bps-of new-entries) u0))
  )
    (asserts! (is-eq tx-sender ADMIN) ERR_NOT_ADMIN)
    (asserts! (> new-count u0) ERR_EMPTY_REGISTRY)
    (asserts! (<= new-count MAX_RECIPIENTS) ERR_TOO_MANY_RECIPIENTS)
    (asserts! (is-eq total-bps u10000) ERR_INVALID_SHARE_SUM)
    (asserts! (is-eq (contract-of token) USDCX_CONTRACT) ERR_WRONG_TOKEN_CONTRACT)
    (asserts! (is-eq balance u0) ERR_BALANCE_NOT_ZERO)
    ;; Clear every possible slot (0-4) before writing new ones, so a shrinking
    ;; registry doesn't leave a stale recipient claimable at old shares.
    (map clear-slot (list u0 u1 u2 u3 u4))
    (fold write-entry new-entries u0)
    (var-set recipient-count new-count)
    (ok true))) 
