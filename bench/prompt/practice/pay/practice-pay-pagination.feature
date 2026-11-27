Feature: Transaction feed pagination

  Background:
    Given I am signed in as "Heath93" with password "s3cret"

  Scenario: Scrolling the public feed loads more transactions
    Given the Everyone feed shows its first transactions
    When I scroll down through the transaction list until more entries load
    Then I can see transactions below the initial batch in the same feed
