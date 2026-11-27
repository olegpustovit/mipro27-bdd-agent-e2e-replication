Feature: Accepting a payment request

  Scenario: Accepting a request turns it into a charge
    Given Lia Rosenbaum ("Judah_Dietrich50", password "s3cret") has requested $25.00 from Ted Parisian for "Concert tickets"
    And Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the transaction "Concert tickets" from the "Mine" tab
    And the transaction reads "Lia Rosenbaum requested Ted Parisian"
    When Ted clicks "Accept Request"
    # TARGETED STEP
    Then the transaction reads "Lia Rosenbaum charged Ted Parisian"
