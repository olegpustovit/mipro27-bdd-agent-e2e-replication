# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright==1.61.0"]
# ///
"""Check transaction submission in a disposable, seeded v1 or v2 app."""
import argparse
import os
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def is_transaction_post(request):
    return request.method == "POST" and urlsplit(request.url).path == "/transactions"


def check(browser, url, version, username, password):
    page = browser.new_page()
    page.goto(url)
    page.get_by_test_id("login-username").locator("input").fill(username)
    page.get_by_test_id("login-password").locator("input").fill(password)
    page.get_by_test_id("signin-submit").click()
    new_transaction = page.get_by_test_id("nav-top-new-transaction")
    expect(new_transaction).to_be_visible()

    for action, expected_type in [("Enter", "request"), ("Pay", "payment"), ("Request", "request")]:
        new_transaction.click()
        page.locator('[data-test^="user-list-item-"]').first.click()
        form = page.get_by_test_id("transaction-create-form")
        form.get_by_test_id("transaction-create-amount-input").locator("input").fill("1")
        note = f"P4c2 {version} {action}"
        description = form.get_by_test_id("transaction-create-description-input").locator("input")
        description.fill(note)

        def activate():
            if action == "Enter":
                description.press("Enter")
            else:
                hook = "pay" if action == "Pay" else "request"
                form.get_by_test_id(f"transaction-create-{hook}-button").click()

        if version == "v2":
            posts = []

            def observe(request):
                if is_transaction_post(request):
                    posts.append(request)

            page.on("request", observe)
            continue_button = form.get_by_test_id("transaction-create-continue")
            expect(continue_button).to_be_disabled()
            expect(form.get_by_test_id("transaction-create-pay-button")).to_have_attribute(
                "aria-pressed", "false"
            )
            expect(form.get_by_test_id("transaction-create-request-button")).to_have_attribute(
                "aria-pressed", "false"
            )
            activate()
            if action != "Enter":
                continue_button.click()
            title = f"Confirm {expected_type}"
            dialog = page.get_by_role("dialog", name=title)
            expect(dialog).to_be_visible()
            assert not posts, f"{action}: sent a transaction before confirmation"

            dialog.get_by_test_id("transaction-review-back").click()
            expect(dialog).to_be_hidden()
            expect(description).to_have_value(note)
            assert not posts, f"{action}: sent a transaction on Back"
            continue_button.click()
            expect(dialog).to_be_visible()
            submit = dialog.get_by_test_id("transaction-review-confirm").click
        else:
            submit = activate

        with page.expect_response(lambda response: is_transaction_post(response.request)) as pending:
            submit()
        response = pending.value
        assert response.ok, f"{action}: transaction POST returned HTTP {response.status}"
        assert response.request.post_data_json["transactionType"] == expected_type
        transaction = response.json()["transaction"]
        assert transaction["id"] and transaction["description"] == note
        if version == "v2":
            assert len(posts) == 1, f"{action}: sent {len(posts)} transaction POSTs"
            page.remove_listener("request", observe)
        return_button = page.get_by_test_id("new-transaction-return-to-transactions")
        expect(return_button).to_be_visible()
        return_button.click()
        print(f"{version} {action}: {expected_type}, HTTP {response.status}, step three reached")

    page.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", choices=["v1", "v2"])
    parser.add_argument("url")
    parser.add_argument("username")
    parser.add_argument("--browser", help="Optional path to an installed Chromium executable")
    args = parser.parse_args()
    if urlsplit(args.url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("Use a disposable local app instance.")
    password = os.environ["P4C2_FIXTURE_PASSWORD"]
    with sync_playwright() as playwright:
        playwright.selectors.set_test_id_attribute("data-test")
        browser = playwright.chromium.launch(executable_path=args.browser)
        try:
            check(browser, args.url, args.version, args.username, password)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
