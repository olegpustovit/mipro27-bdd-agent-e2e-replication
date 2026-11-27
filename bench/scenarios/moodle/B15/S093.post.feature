@block @block_accessreview @javascript
Feature: Block accessreview

  Background:
    Given the following "courses" exist:
      | fullname | shortname | format |
      | Course 1 | C1 | topics |
    And the following config values are set as admin:
      | analysistype | 1 | tool_brickfield |

  Scenario: View accessreview block on a course
    Given I log in as "admin"
    And I am on "Course 1" course homepage with editing mode on
    When I add the "Accessibility review" block
    Then I should see "Accessibility review"
    And I should see "Your accessibility toolkit needs to be registered."
