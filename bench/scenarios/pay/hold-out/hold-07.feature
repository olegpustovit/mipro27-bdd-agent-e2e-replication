Feature: Rejecting a payment request

  Scenario: Rejecting a request closes it without charging
    Given Lia Rosenbaum ("Judah_Dietrich50", password "s3cret") has requested $30.00 from Ted Parisian for "Pizza night"
    And Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the transaction "Pizza night" from the "Mine" tab
    And the "Accept Request" and "Reject Request" buttons are shown
    When Ted clicks "Reject Request"
    # TARGETED STEP
    Then the "Accept Request" and "Reject Request" buttons are no longer shown
    And the transaction still reads "Lia Rosenbaum requested Ted Parisian"
