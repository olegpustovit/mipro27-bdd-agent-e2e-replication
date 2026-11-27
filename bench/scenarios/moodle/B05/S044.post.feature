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
  Scenario: Repaginate questions using "add page break" or "Remove page break" icons
    When I click on the "Add" page break icon after question "Question1 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "2"
    And I should see "Question3 text" on quiz page "2"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "2"
    And I should see "Question6 text" on quiz page "2"
    And I should see "Question7 text" on quiz page "2"
    And I should see "Question8 text" on quiz page "2"
    And I should see "Question9 text" on quiz page "2"
    When I click on the "Remove" page break icon after question "Question1 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "1"
    And I should see "Question4 text" on quiz page "1"
    And I should see "Question5 text" on quiz page "1"
    And I should see "Question6 text" on quiz page "1"
    And I should see "Question7 text" on quiz page "1"
    And I should see "Question8 text" on quiz page "1"
    And I should see "Question9 text" on quiz page "1"
    And I should not see "Page 2" in the "region-main" "region"
    And I open the "last" add to quiz menu
    And I choose "from question bank" in the open action menu
    When I click on "Add to quiz" "link" in the "Question10 text" "table_row"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "1"
    And I should see "Question4 text" on quiz page "1"
    And I should see "Question5 text" on quiz page "1"
    And I should see "Question6 text" on quiz page "1"
    And I should see "Question7 text" on quiz page "1"
    And I should see "Question8 text" on quiz page "1"
    And I should see "Question9 text" on quiz page "1"
    And I should see "Question10 text" on quiz page "1"
    And I should not see "Page 2" in the "region-main" "region"
    When I click on the "Add" page break icon after question "Question2 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "2"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "2"
    And I should see "Question6 text" on quiz page "2"
    And I should see "Question7 text" on quiz page "2"
    And I should see "Question8 text" on quiz page "2"
    And I should see "Question9 text" on quiz page "2"
    And I should see "Question10 text" on quiz page "2"
    And I should not see "Page 3" in the "region-main" "region"
    When I click on the "Add" page break icon after question "Question1 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "2"
    And I should see "Question3 text" on quiz page "3"
    And I should see "Question4 text" on quiz page "3"
    And I should see "Question5 text" on quiz page "3"
    And I should see "Question6 text" on quiz page "3"
    And I should see "Question7 text" on quiz page "3"
    And I should see "Question8 text" on quiz page "3"
    And I should see "Question9 text" on quiz page "3"
    And I should see "Question10 text" on quiz page "3"
    When I click on the "Remove" page break icon after question "Question2 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "2"
    And I should see "Question3 text" on quiz page "2"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "2"
    And I should see "Question6 text" on quiz page "2"
    And I should see "Question7 text" on quiz page "2"
    And I should see "Question8 text" on quiz page "2"
    And I should see "Question9 text" on quiz page "2"
    And I should see "Question10 text" on quiz page "2"
    And I should not see "Page 3" in the "region-main" "region"
    When I click on the "Remove" page break icon after question "Question1 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "1"
    And I should see "Question4 text" on quiz page "1"
    And I should see "Question5 text" on quiz page "1"
    And I should see "Question6 text" on quiz page "1"
    And I should see "Question7 text" on quiz page "1"
    And I should see "Question8 text" on quiz page "1"
    And I should see "Question9 text" on quiz page "1"
    And I should see "Question10 text" on quiz page "1"
    And I should not see "Page 2" in the "region-main" "region"
    When I press "Repaginate"
    And I set the field "menuquestionsperpage" to "1"
    And I click on "Go" "button" in the "Repaginate" "dialogue"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "2"
    And I should see "Question3 text" on quiz page "3"
    And I should see "Question4 text" on quiz page "4"
    And I should see "Question5 text" on quiz page "5"
    And I should see "Question6 text" on quiz page "6"
    And I should see "Question7 text" on quiz page "7"
    And I should see "Question8 text" on quiz page "8"
    And I should see "Question9 text" on quiz page "9"
    And I should see "Question10 text" on quiz page "10"
    And I should not see "Page 11" in the "region-main" "region"
    When I press "Repaginate"
    And I set the field "menuquestionsperpage" to "2"
    And I click on "Go" "button" in the "Repaginate" "dialogue"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "2"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "3"
    And I should see "Question6 text" on quiz page "3"
    And I should see "Question7 text" on quiz page "4"
    And I should see "Question8 text" on quiz page "4"
    And I should see "Question9 text" on quiz page "5"
    And I should see "Question10 text" on quiz page "5"
    And I should not see "Page 6" in the "region-main" "region"
    When I click on the "Add" page break icon after question "Question9 text"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "2"
    And I should see "Question4 text" on quiz page "2"
    And I should see "Question5 text" on quiz page "3"
    And I should see "Question6 text" on quiz page "3"
    And I should see "Question7 text" on quiz page "4"
    And I should see "Question8 text" on quiz page "4"
    And I should see "Question9 text" on quiz page "5"
    And I should see "Question10 text" on quiz page "6"
    When I press "Repaginate"
    And I set the field "menuquestionsperpage" to "Unlimited"
    And I click on "Go" "button" in the "Repaginate" "dialogue"
    Then I should see "Question1 text" on quiz page "1"
    And I should see "Question2 text" on quiz page "1"
    And I should see "Question3 text" on quiz page "1"
    And I should see "Question4 text" on quiz page "1"
    And I should see "Question5 text" on quiz page "1"
    And I should see "Question6 text" on quiz page "1"
    And I should see "Question7 text" on quiz page "1"
    And I should see "Question8 text" on quiz page "1"
    And I should see "Question9 text" on quiz page "1"
    And I should see "Question10 text" on quiz page "1"
    And I should not see "Page 2" in the "region-main" "region"
