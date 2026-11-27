Feature: Sign up

  Scenario: A newly signed-up user can sign in and is greeted by onboarding
    Given the visitor is on the Sign Up page
    When the visitor signs up with first name "Avery", last name "Lane", username "Avery_Lane", password "s3cret" and confirmation "s3cret"
    And the visitor signs in as "Avery_Lane" with password "s3cret"
    # TARGETED STEP
    Then the "Get Started with Real World App" dialog is shown
