# Source report

Payment Request lacks `on_payment_authorized()` handler for Stripe success flow, causing successful Stripe payments to remain in `Requested` state

> still leave the ERPNext `Payment Request` in status `Requested`.

[frappe/payments #204](https://github.com/frappe/payments/issues/204)
