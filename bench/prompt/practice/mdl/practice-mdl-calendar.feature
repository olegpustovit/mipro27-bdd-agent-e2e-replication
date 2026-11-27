Feature: Calendar navigation

  Background:
    Given I sign in using the practice account "{{practice_username}}" and password "{{practice_password}}"

  Scenario: Browse to the next calendar month and return
    Given I open the full Moodle calendar and note its displayed month and year
    When I move to the next month
    Then the calendar shows the month immediately after the one I noted
    When I move back one month
    Then the calendar shows the month and year I originally noted
