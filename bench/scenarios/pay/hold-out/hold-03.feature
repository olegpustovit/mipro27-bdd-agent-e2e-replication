Feature: Sign up validation

  Scenario: Sign up rejects a password confirmation that does not match
    Given the visitor is on the Sign Up page
    When the visitor fills in first name "Avery", last name "Lane", username "Avery_Lane" and password "s3cret"
    And the visitor enters "s3cret99" as the password confirmation and leaves the field
    # TARGETED STEP
    Then the message "Password does not match" is shown under Confirm Password
    And the "Sign Up" button is disabled
