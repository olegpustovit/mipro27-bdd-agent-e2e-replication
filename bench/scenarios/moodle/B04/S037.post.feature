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

  Scenario: Completion condition displaying setting can be disabled at course level
    Given I log in as "teacher1"
    And I am on "Course 1" course homepage with editing mode on
    And I navigate to "Settings" in current page administration
    When I set the following fields to these values:
      | Show activity completion conditions | No |
    And I click on "Save and display" "button"
    And there should be no completion information shown for "Test choice auto"
    And I follow "Test choice auto"
    Then "Test choice auto" should have the "Make a choice" completion condition
    And I am on "Course 1" course homepage
    And the manual completion button for "Test choice manual" should not exist
    And I follow "Test choice manual"
    And the manual completion button for "Test choice manual" should be disabled
