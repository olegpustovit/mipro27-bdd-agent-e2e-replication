Feature: Accepting a payment request
  Setup has already created a $25.00 request from Lia Rosenbaum to Ted Parisian for "Concert tickets".

  Scenario: Accepting a request turns it into a charge
    Given Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the transaction "Concert tickets" from the "Mine" tab
    And the transaction reads "Lia Rosenbaum requested Ted Parisian"
    When Ted clicks "Accept Request"
    # TARGETED STEP
    Then the transaction reads "Lia Rosenbaum charged Ted Parisian"
