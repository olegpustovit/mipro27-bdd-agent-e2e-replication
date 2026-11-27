Feature: Adapter smoke
  Scenario: Reveal a confirmation
    Given I open the application URL
    When I click Show confirmation
    Then Confirmation visible is displayed
