@mod @mod_assign @core_completion
Feature: View activity completion in the assignment activity

  Background:
    Given the following "users" exist:
      | username | firstname | lastname | email |
      | student1 | Vinnie | Student1 | student1@example.com |
      | teacher1 | Darrell | Teacher1 | teacher1@example.com |
    And the following "courses" exist:
      | fullname | shortname | enablecompletion | showcompletionconditions |
      | Course 1 | C1 | 1 | 1 |
    And the following "course enrolments" exist:
      | user | course | role |
      | student1 | C1 | student |
      | teacher1 | C1 | editingteacher |
    And the following "activity" exists:
      | activity | assign |
      | course | C1 |
      | idnumber | mh1 |
      | name | Music history |
      | section | 1 |
      | completion | 1 |
      | grade[modgrade_type] | point |
      | grade[modgrade_point] | 100 |
    And the following "activity" exists:
      | activity | assign |
      | course | C1 |
      | idnumber | mh2 |
      | name | Music history 2 |
      | section | 1 |
      | assignsubmission_onlinetext_enabled | 1 |
      | attemptreopenmethod | manual |
      | maxattempts | -1 |
      | completion | 2 |
      | completionsubmit | 1 |
      | grade[modgrade_type] | point |
      | grade[modgrade_point] | 100 |

  @javascript
  Scenario: Assign module manual completion button hidden if Show activity completion is set to No
    Given I am on the "Course 1" course page logged in as teacher1
    And I navigate to "Settings" in current page administration
    And I expand all fieldsets
    And I set the field "Show activity completion conditions" to "No"
    And I press "Save and display"
    And "Completion" "button" should not exist in the "Music history" "activity"
    And I log out
    When I am on the "Course 1" course page logged in as "student1"
    Then the manual completion button for "Music history" should not exist
    And I am on the "Music history" "assign activity" page
    And the manual completion button for "Music history" should exist
