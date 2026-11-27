# Source report

Payment Request lacks `on_payment_authorized()` handler for Stripe success flow, causing successful Stripe payments to remain in `Requested` state

> still leave the ERPNext `Payment Request` in status `Requested`.

[frappe/payments #204](https://github.com/frappe/payments/issues/204)

Label: re-created-from-report. This bug re-creates the failure described in the cited real bug report; it is not a reverted fix from this app's history.
