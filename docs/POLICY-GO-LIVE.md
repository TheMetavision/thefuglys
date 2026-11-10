# Policy wording to publish at go-live (The Fuglys)

Prepared 2026-11-01 on branch `chore/policy-wording`. **Nothing here is applied.** Paste each block into the Studio (thefuglys.sanity.studio → Legal Pages) when `/returns` and Sendcloud labels are live for The Fuglys, then publish.

Why a file and not a Sanity draft: a document has only one draft, and the Group A fixes (Shipping Policy) already sit in it. Privacy and Returns have no draft today, but keeping all go-live text together means nothing can be published early by accident.

⚠ Legal wording. Check it yourself before publishing.

## Group B, 1: Privacy Policy, delivery and returns

Document `legalPage.privacy-policy`, section **"4. Who we share it with"**.

**a)** Add two bullets after "Print-on-demand fulfilment partners — …":

- **Sendcloud** — creating postage labels for the wall art we print and post ourselves, and for returns.
- **Delivery companies** (such as Royal Mail, Evri, InPost, DPD or UPS) — delivering and tracking your parcel, under their own privacy policies.

**b)** At the end of section 4, add an **h3 "Delivery & Returns"** and these four paragraphs. This is Comic Strip Canvas's live wording, which names no brand, so nothing needs swapping:

> To get your order to you, we share your name and delivery address with Sendcloud, the shipping platform we use to create postage labels, and with the carrier that delivers your parcel (such as Royal Mail, Evri, InPost, DPD or UPS). We do this because it's necessary to fulfil your order.

> Sendcloud processes these details on our behalf and only on our instructions. Carriers use them to deliver and track your parcel, and handle them under their own privacy policies.

> If you return an item, we share your name, address, email address and, if you've given us one, your phone number with Sendcloud and with the carrier that collects or handles your return, so they can arrange a collection or send you drop-off details and keep you updated. We buy the return label for you and never share your payment details.

> Sendcloud is based in the Netherlands and processes data within the European Economic Area. You can read its privacy policy at sendcloud.com/en_uk/privacy-policy, and each carrier's privacy policy is on its own website.

Section 5 (International transfers) needs nothing: Sendcloud processes in the EEA.

## Group B, 2: Returns & Refunds

Document `legalPage.returns-refunds`. The return window stays The Fuglys's own: **14 days to cancel from delivery, then a further 14 days to send it back (§2)**. Faulty, damaged or wrong items stay free (§5, 30 days).

**a) "6. How to return an item":** replace the numbered list with:

1. **Wall art (UK addresses):** go to thefuglys.com/returns, enter your order reference (the # code in your order confirmation email) and the email you ordered with, and choose what's coming back. You'll see the return postage before you send the request. Once we've approved it, we email you a prepaid return label, and its cost is deducted from your refund.
2. **Clothing and other merchandise, or an address outside the UK:** email contact@themetavision.co.uk with your order number and reason for return. We will reply with a returns address and any reference number.
3. Pack the item securely (wall art in its original tube or box) with a copy of your order confirmation.
4. If you send it back yourself, use a tracked service and keep your receipt — we cannot refund items lost in return transit.
5. Once received and inspected, we will issue your refund to the original payment method within 14 days.

**b) "Who pays for return postage?":** replace the change-of-mind bullet with:

- Change of mind / unwanted items: you cover the cost. If we email you a prepaid return label, its cost is deducted from your refund — for wall art returned through our returns page you'll see the amount before you submit.

Keep the faulty bullet as it is: "Faulty / wrong / damaged items: we cover the cost."

**c) §2 "Conditions for return":** add a bullet: *wall art must be unused and returned in its original tube or box.*


## Group C: Privacy Policy, customer emails and referral codes

Added 2026-11-02 on branch `feat/post-delivery-sequence`. **Nothing here is applied.** Publish it in the Studio (Legal Pages → Privacy Policy, document `legalPage.privacy-policy`) **before** the post-delivery automation in MailerLite is switched on, and before any email goes to past customers.

⚠ Legal wording, and one real legal question. The soft opt-in (PECR reg. 22) needs the customer to have been given a simple way to refuse **when their details were collected**. Buyers from now on get that (the "Don't send me offers or referral emails" box in the cart). Buyers from before the box existed were not offered it at checkout, so emailing them on the soft opt-in is arguable rather than clear-cut. The wording below covers them as you asked ("unless you opt out"), but decide yourself (or with advice) whether past buyers get anything before they have had a chance to refuse; a first email to them that leads with the opt-out is the cautious route.

Update (same branch): orders placed before the box existed (no `marketingConsent` on the order) are now sent to MailerLite with `<prefix>_marketing_ok = "no"`, so they never get the referral email; they still get the service emails. Gate any offers email in the automation on `_marketing_ok = yes` too. Retention stays at three years.

**a) "4. Why we use it (legal bases)":** replace the bullet

> Consent — for marketing emails (our newsletter) and for Google Analytics cookies. You can withdraw consent at any time using the unsubscribe link in any email, or the "Cookie settings" link at the bottom of any page.

with these two bullets:

> Consent — for our newsletter (if you sign up to it) and for Google Analytics cookies. You can withdraw consent at any time using the unsubscribe link in any email, or the "Cookie settings" link at the bottom of any page.

> Legitimate interests (customers) — once you've ordered from us, we email you after your order ships: a check that it arrived, your own referral code to share with friends, and now and then news and offers about similar The Fuglys products. We rely on the "soft opt-in" for existing customers (regulation 22 of the Privacy and Electronic Communications Regulations), with our legitimate interest in keeping in touch with our customers as the lawful basis. This covers past customers as well as new ones. You can say no at any time: tick "Don't send me offers or referral emails" in your basket when you order, use the unsubscribe link in any of these emails, or email contact@themetavision.co.uk. Saying no never affects the emails we need to send about your order (order confirmation and delivery updates).

**b) "5. Who we share it with":** replace the two bullets below.

The Stripe bullet ("Stripe, Inc. — payment processing.") becomes:

> Stripe, Inc. — payment processing, and the referral codes we create for you. Your email address and order reference are stored with your code so we can send you a thank-you code when a friend uses it. We never tell you who used your code, and never tell them who you are.

The MailerLite bullet ("MailerLite — newsletter and marketing email delivery (only if you have subscribed).") becomes:

> MailerLite — newsletter emails (only if you have subscribed) and the emails we send customers after an order ships. For customers we share your email address, your order reference, what you ordered and when, your referral code and whether you're happy to receive offers. This includes past customers, unless you have opted out or unsubscribed. If you ticked "Don't send me offers or referral emails" when you ordered, we don't add you to MailerLite for that order.

**c) "7. How long we keep it":** add after the "Newsletter subscribers" bullet:

> Customer emails (MailerLite) — until you unsubscribe or ask us to stop, or three years after your most recent order, whichever comes first. After you unsubscribe we keep a suppression record so we do not email you again. Referral codes stay in Stripe while they can still be used; the thank-you code you get when a friend orders works once.

**d) "8. Your rights":** the bullet "withdraw consent for marketing emails…" can stay as it is; add:

> object to our customer emails at any time (unsubscribe link, or email us), after which we stop.

Codes, for reference (no need to name them in the policy): friend codes start FUG-, thank-you codes FGTHX-.

## Group D: Privacy Policy, games and the Scrap Dash leaderboard

Added 2026-11-10 on branch `feature/scrap-dash`. **Nothing here is applied.** Publish it in the Studio (Legal Pages → Privacy Policy, document `legalPage.privacy-policy`) **before** Scrap Dash goes live on thefuglys.com, because the leaderboard starts collecting runs as soon as the game is public. Adapted from the Labrats privacy-policy section for Vent Runner, which runs the same leaderboard.

⚠ Legal wording. Check it yourself before publishing. The contact address is `contact@thefuglys.com` (confirmed; it is also where month-end summaries and prize claims are emailed).

Add a new section (after "How long we keep it", or as the last numbered section) headed **"Games and the Scrap Dash leaderboard"**:

> You don't need to give us any personal information to play our games.

> When a run of Scrap Dash ends, the game sends us the distance, score, stage and runner, together with a randomly created racing name and a random code stored on your device. We use the device code only to recognise a device that has won a prize, including one that passes down to it, and show it the prize message. We don't use it to track anyone, and it isn't linked to any personal information. We keep each month's leaderboard for 24 months, then delete it. We keep a record of each month's top 10 racing names and distances, so that a prize can pass down the list, and of who won, as our prize history. These records contain no personal information. Junkyard Racers sends us nothing: its progress and best laps stay in your browser.

> To claim a prize, the winner (if they're 18 or over) or their parent or guardian gives us their name, email address and delivery address, says which of the two they are, and chooses the T-shirt. We use these details only to send the prize and to contact them about it. To make and post the T-shirt, we pass the name and delivery address (not the email address) to our printing partner, Printful, who uses them only for that order and keeps its order records under its own privacy policy. We don't add claimants to any mailing list or send them offers, referral codes or marketing unless they separately ask to join our newsletter, and we delete our copy of their details once the prize has been sent (and within 90 days at most). If a prize passes to the next player, we don't share anything about the earlier winner with them.

> Our lawful basis for running the leaderboard is our legitimate interest in running a fair game. For prize claims it is to send the prize the claimant has asked for. To ask about or delete leaderboard data, email contact@thefuglys.com. The full rules are at [thefuglys.com/games/leaderboard-terms/](https://thefuglys.com/games/leaderboard-terms/).
