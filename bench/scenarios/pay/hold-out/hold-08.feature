Feature: Amount range filter

  Scenario: Filtering the Mine feed to amounts between $10 and $20
    Given Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the "Mine" tab
    When Ted opens the "Amount: $0 - $1,000" filter and sets the range to $10 - $20
    Then the filter chip reads "Amount: $10 - $20"
    And at least one transaction is listed
    # TARGETED STEP
    And every listed transaction shows an amount between $10.00 and $20.00
