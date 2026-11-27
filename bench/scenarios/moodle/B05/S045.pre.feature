@mod @mod_quiz
Feature: Edit quiz page - pagination

  Background:
    Given the following "users" exist:
      | username | firstname | lastname | email |
      | teacher1 | T1 | Teacher1 | teacher1@example.com |
      | student1 | S1 | Student1 | student1@example.com |
    And the following "courses" exist:
      | fullname | shortname | category |
      | Course 1 | C1 | 0 |
    And the following "course enrolments" exist:
      | user | course | role |
      | teacher1 | C1 | editingteacher |
      | student1 | C1 | student |
    And the following "activities" exist:
      | activity | name | course | idnumber | questionsperpage | navmethod |
      | quiz | Quiz 1 | C1 | quiz1 | 0 | sequential |
    And the following "questions" exist:
      | questioncategory | qtype | name | questiontext |
      | Default for Quiz 1 | truefalse | 1 | Question1 text |
      | Default for Quiz 1 | truefalse | 2 | Question2 text |
      | Default for Quiz 1 | truefalse | 3 | Question3 text |
      | Default for Quiz 1 | truefalse | 4 | Question4 text |
      | Default for Quiz 1 | truefalse | 5 | Question5 text |
      | Default for Quiz 1 | truefalse | 6 | Question6 text |
      | Default for Quiz 1 | truefalse | 7 | Question7 text |
      | Default for Quiz 1 | truefalse | 8 | Question8 text |
      | Default for Quiz 1 | truefalse | 9 | Question9 text |
      | Default for Quiz 1 | truefalse | 10 | Question10 text |
    And quiz "Quiz 1" contains the following questions:
      | question | page |
      | 1 | 1 |
      | 2 | 1 |
      | 3 | 1 |
      | 4 | 1 |
      | 5 | 1 |
      | 6 | 1 |
      | 7 | 1 |
      | 8 | 1 |
      | 9 | 1 |
    And I am on the "Quiz 1" "mod_quiz > Edit" page logged in as teacher1

  @javascript
  Scenario: Teacher can repaginate questions using the move icon
    Given I click on the "Add" page break icon after question "Question3 text"
    And I click on the "Add" page break icon after question "Question7 text"
    When I move "Question6 text" to "After Question 3" in the quiz by clicking the move icon
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "1"
    And I should see "Question6 text" on quiz page "1"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "2"
    And I should see "Question7 text" on quiz page "2"
    And I should see "Question8 text" on quiz page "3"
    And I should see "Question9 text" on quiz page "3"
    When I move "Question7 text" to "After Question 9" in the quiz by clicking the move icon
    And I move "Question1 text" to "After Question 9" in the quiz by clicking the move icon
    Then I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "1"
    And I should see "Question6 text" on quiz page "1"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "2"
    And I should see "Question8 text" on quiz page "3"
    And I should see "Question9 text" on quiz page "3"
    And I should see "Question7 text" on quiz page "3"
    And I should see "Question1 text" on quiz page "3"
