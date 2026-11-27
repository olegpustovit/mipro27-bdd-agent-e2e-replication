@core @core_completion
Feature: Allow teachers to edit the visibility of completion conditions in a course

  Background:
    Given the following "users" exist:
      | username | firstname | lastname | email |
      | teacher1 | Teacher | 1 | teacher1@example.com |
    And the following "courses" exist:
      | fullname | shortname | enablecompletion | showcompletionconditions |
      | Course 1 | C1 | 1 | 1 |
    And the following "course enrolments" exist:
      | user | course | role |
      | teacher1 | C1 | editingteacher |
    And the following "activities" exist:
      | activity | course | idnumber | name | completion | completionsubmit |
      | choice | C1 | c1m | Test choice manual | 1 | 0 |
      | choice | C1 | c1a | Test choice auto | 2 | 1 |

  @javascript
  Scenario: Completion condition displaying for manual and auto completion
    Given I log in as "teacher1"
    When I am on "Course 1" course homepage
    Then "Test choice manual" should have the "Mark as done" completion condition
    And I follow "Test choice manual"
    And the manual completion button for "Test choice manual" should be disabled
    And I am on "Course 1" course homepage
    And "Test choice auto" should have the "Make a choice" completion condition
    And I follow "Test choice auto"
    And "Test choice auto" should have the "Make a choice" completion condition
