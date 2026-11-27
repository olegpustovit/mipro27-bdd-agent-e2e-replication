@block @block_activity_results
Feature: The activity results block doesn't displays student scores for unconfigured block

  Background:
    Given the following "users" exist:
      | username | firstname | lastname | email | idnumber |
      | teacher1 | Teacher | 1 | teacher1@example.com | T1 |
    And the following "courses" exist:
      | fullname | shortname | category |
      | Course 1 | C1 | 0 |
    And the following "course enrolments" exist:
      | user | course | role |
      | teacher1 | C1 | editingteacher |
    And I log in as "teacher1"
    And I am on "Course 1" course homepage with editing mode on

  Scenario: Add the block to a the course with Javascript disabled
    Given I add the "Activity results" block
    Then I should see "Please configure this block and select which activity it should display results from." in the "Activity results" "block"
