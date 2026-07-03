(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token mock-token)

(define-public (mint (amount uint) (recipient principal))
  (ft-mint? mock-token amount recipient)
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err u4))
    (match (ft-transfer? mock-token amount sender recipient)
      success (begin
        (print memo)
        (ok success))
      error (err error))
  )
)

(define-read-only (get-name)
  (ok "Mock Token")
)

(define-read-only (get-symbol)
  (ok "MOCK")
)

(define-read-only (get-decimals)
  (ok u6)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance mock-token account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply mock-token))
)

(define-read-only (get-token-uri)
  (ok none)
)
