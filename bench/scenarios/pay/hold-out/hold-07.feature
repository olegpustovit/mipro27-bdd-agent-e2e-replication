Feature: Rejecting a payment request
  Setup has already created a $30.00 request from Lia Rosenbaum to Ted Parisian for "Pizza night".

  Scenario: Rejecting a request closes it without charging
    Given Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the transaction "Pizza night" from the "Mine" tab
    And the "Accept Request" and "Reject Request" buttons are shown
    When Ted clicks "Reject Request"
    # TARGETED STEP
    Then the "Accept Request" and "Reject Request" buttons are no longer shown
    And the transaction still reads "Lia Rosenbaum requested Ted Parisian"
