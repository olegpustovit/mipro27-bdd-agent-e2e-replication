@mod @mod_quiz
Feature: Edit quiz page - section headings

  Background:
    Given the following "users" exist:
      | username | firstname | lastname | email |
      | teacher1 | T1 | Teacher1 | teacher1@example.com |
    And the following "courses" exist:
      | fullname | shortname | category |
      | Course 1 | C1 | 0 |
    And the following "course enrolments" exist:
      | user | course | role |
      | teacher1 | C1 | editingteacher |
    And the following "activities" exist:
      | activity | name | course | idnumber |
      | qbank | Qbank 1 | C1 | qbank1 |
    And the following "question categories" exist:
      | contextlevel | reference | name |
      | Activity module | qbank1 | Test questions |
    And I log in as "teacher1"

  @javascript
  Scenario: Add section heading option only appears for pages that are not the first in their section.
    Given the following "activities" exist:
      | activity | name | intro | course | idnumber |
      | quiz | Quiz 1 | Quiz 1 description | C1 | quiz1 |
    And the following "questions" exist:
      | questioncategory | qtype | name | questiontext |
      | Test questions | truefalse | TF1 | This is question 01 |
      | Test questions | truefalse | TF2 | This is question 02 |
      | Test questions | truefalse | TF3 | This is question 03 |
    And quiz "Quiz 1" contains the following questions:
      | question | page |
      | TF1 | 1 |
      | TF2 | 1 |
      | TF3 | 2 |
    When I am on the "Quiz 1" "mod_quiz > Edit" page
    And I click on the "Add" page break icon after question "TF1"
    And I open the action menu in "Page 1" "list_item"
    Then "a new section heading" "link" in the "Page 1" "list_item" should not be visible
    And I click on ".numberofquestions" "css_element"
    And I open the action menu in "Page 2" "list_item"
    And "a new section heading" "link" in the "Page 2" "list_item" should be visible
    And I click on ".numberofquestions" "css_element"
    And I open the action menu in "Page 3" "list_item"
    And "a new section heading" "link" in the "Page 3" "list_item" should be visible
    And I click on ".numberofquestions" "css_element"
    And I open the action menu in ".last-add-menu" "css_element"
    And "a new section heading" "link" in the ".last-add-menu" "css_element" should not be visible
