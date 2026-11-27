Feature: Searching for people when starting a transaction

  Scenario: Searching by first name brings the matching person to the top
    Given Ted Parisian is signed in as "Heath93" with password "s3cret"
    And Ted clicks "New" in the top bar
    And the people list shows "Kristian Bradtke" first
    When Ted types "Ruthie" into the "Search..." box
    # TARGETED STEP
    Then the first person in the list is "Ruthie Prosacco"
