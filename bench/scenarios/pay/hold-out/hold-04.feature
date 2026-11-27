Feature: Phone number in user settings

  Scenario: Changing the phone number persists after reload
    Given Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the My Account page
    And the Phone Number field shows "398-225-9900"
    When Ted replaces the phone number with "555-123-4567"
    And Ted clicks "Save"
    And Ted reloads the My Account page
    # TARGETED STEP
    Then the Phone Number field shows "555-123-4567"
