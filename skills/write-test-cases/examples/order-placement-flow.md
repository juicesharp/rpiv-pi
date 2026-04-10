---
id: TC-ORD-001
title: "Place order with physical products"
feature: "Order Management"
priority: high
type: functional
status: draft
tags: ["orders", "checkout", "payment", "happy-path"]
generated_at_commit: abc1234
---

# Place order with physical products

## Objective
Verify that a customer can browse products, add them to cart, complete checkout with a valid credit card, and receive an order confirmation. This is the primary revenue-generating flow.

## Preconditions
- Customer account exists with verified email
- At least 2 physical products are published with available inventory
- Stripe test mode is configured with valid API keys
- Customer is logged into the Customer Portal

## Steps
| # | Action | Expected Result |
|---|--------|-----------------|
| 1 | Navigate to product catalog page | Product listing displays with prices and availability |
| 2 | Click "Add to Cart" on first product | Cart badge updates to show 1 item, toast confirms addition |
| 3 | Click "Add to Cart" on second product | Cart badge updates to 2 items |
| 4 | Click cart icon in navigation header | Cart drawer slides open showing both products with quantities and subtotal |
| 5 | Click "Proceed to Checkout" | Checkout page loads with shipping address form |
| 6 | Enter valid shipping address and select shipping method | Shipping cost calculates and order total updates |
| 7 | Enter valid test credit card (4242 4242 4242 4242) | Card field shows validated state with card brand icon |
| 8 | Click "Place Order" | Loading spinner appears, then redirects to order confirmation page |
| 9 | Verify order confirmation page | Order number displayed, line items match cart, total matches checkout |

## Postconditions
- Order record created in database with status "pending_fulfillment"
- Order confirmation email sent to customer's email address
- Inventory quantity decremented for both purchased products
- Payment charge captured in Stripe (verify in Stripe dashboard)
- Webhook dispatched to fulfillment service with order details
- Audit log entry created with action "order.created" and customer ID

## Edge Cases
- Order with quantity > 1 of same product — verify inventory deducts correct amount
- Order with product at maximum inventory — verify "last item" handling
- Payment gateway timeout — verify order is not created, customer sees retry option
- Browser back button during payment processing — verify no duplicate charges
- Coupon code applied at checkout — verify discount reflected in total and payment

## Notes
- Related TCs: TC-ORD-002 (cancel order), TC-ORD-003 (refund order)
- Dependencies: Stripe test environment, fulfillment webhook endpoint
- Known issues: Intermittent Stripe webhook delay (up to 30s) may affect postcondition verification
