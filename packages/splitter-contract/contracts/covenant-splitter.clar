;; covenant-splitter.clar
;; Pull-model multi-recipient STX splitter for use as a FlowVault splitAddress target.
;; Recipients and shares are FIXED at deployment. No admin withdraw function exists.
;; Compatible with Clarity 3 / Epoch 3.4+

;; -- Constants: recipients fixed at deploy time -----------------------------
;; Basis points (bps), must sum to exactly u10000.
(define-constant RECIPIENT_1 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5)
(define-constant RECIPIENT_2 'ST2YJMFAPYZWPFCASY1EJQZMCJZRXGEM9VM5N24WJ)
(define-constant RECIPIENT_3 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM)

(define-constant BPS_1 u5000)
(define-constant BPS_2 u3000)
(define-constant BPS_3 u2000)

;; -- Errors ------------------------------------------------------------------
(define-constant ERR_NOT_A_RECIPIENT (err u100))
(define-constant ERR_ZERO_CLAIMABLE  (err u101))
(define-constant ERR_INVALID_SHARE_SUM (err u103))
(define-constant ERR_TRANSFER_FAILED  (err u104))
(define-constant ERR_INSUFFICIENT_BALANCE (err u105))

;; -- Deploy-time invariant check ---------------------------------------------
(define-constant TOTAL_BPS (+ BPS_1 (+ BPS_2 BPS_3)))

;; This will cause the deployment to abort if shares don't sum to 10000
(asserts! (is-eq TOTAL_BPS u10000) ERR_INVALID_SHARE_SUM)

;; -- State -------------------------------------------------------------------
(define-map claimed-by-recipient principal uint)
(define-data-var total-ever-claimed uint u0)

;; -- Read-only helpers -------------------------------------------------------
(define-read-only (get-recipient-bps (who principal))
  (if (is-eq who RECIPIENT_1) BPS_1
  (if (is-eq who RECIPIENT_2) BPS_2
  (if (is-eq who RECIPIENT_3) BPS_3
  u0))))

(define-read-only (get-total-ever-claimed)
  (var-get total-ever-claimed))

(define-read-only (get-claimable-amount (who principal))
  (let (
    (balance      (stx-get-balance (as-contract tx-sender)))
    (ever-claimed (var-get total-ever-claimed))
    (lifetime     (+ balance ever-claimed))
    (share-bps    (get-recipient-bps who))
    (already      (default-to u0 (map-get? claimed-by-recipient who)))
    (entitled     (/ (* lifetime share-bps) u10000))
  )
    (if (> entitled already) (- entitled already) u0)))

;; -- Public: receive ---------------------------------------------------------
;; Anyone can call this to register an inbound STX deposit.
;; FlowVault sends STX here via a normal stx-transfer, so the balance
;; updates automatically - no explicit deposit registration needed.
;; This function is a no-op convenience so the frontend can confirm ABI.
(define-public (receive)
  (ok true))

;; -- Public: claim -----------------------------------------------------------
;; Each registered recipient calls this to pull their claimable share.
(define-public (claim)
  (let (
    (claimer    tx-sender)
    (share-bps  (get-recipient-bps claimer))
    (amount     (get-claimable-amount claimer))
  )
    (asserts! (> share-bps u0) ERR_NOT_A_RECIPIENT)
    (asserts! (> amount u0)    ERR_ZERO_CLAIMABLE)
    (asserts! (<= amount (stx-get-balance (as-contract tx-sender))) ERR_INSUFFICIENT_BALANCE)
    (match (as-contract (stx-transfer? amount tx-sender claimer))
      success
        (begin
          (map-set claimed-by-recipient claimer
            (+ (default-to u0 (map-get? claimed-by-recipient claimer)) amount))
          (var-set total-ever-claimed (+ (var-get total-ever-claimed) amount))
          (ok amount))
      error ERR_TRANSFER_FAILED)))
