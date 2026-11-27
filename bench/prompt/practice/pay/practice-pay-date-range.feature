Feature: Transaction date filter

  Background:
    Given I am signed in as "Heath93" with password "s3cret"

  Scenario: Clear a selected transaction date range
    Given the Everyone feed is open with "Date: ALL"
    When I open the date filter and select the 10th through the 12th of the month shown
    Then the date filter displays the selected range
    When I clear the date range using the X on the date filter
    Then the date filter reads "Date: ALL"
