Feature: Notifications

  Scenario: Dismissing a notification removes it from the list
    Given Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted opens the Notifications page
    And the notification "Kristian Bradtke liked a transaction." is listed
    When Ted clicks "Dismiss" on the notification "Kristian Bradtke liked a transaction."
    # TARGETED STEP
    Then the notification "Kristian Bradtke liked a transaction." is no longer listed
