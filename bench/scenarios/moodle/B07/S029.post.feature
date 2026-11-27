@core @core_search
Feature: Show system information in the search interface

  Background:
    Given the following config values are set as admin:
      | enableglobalsearch | 1 |
      | searchengine | simpledb |
    And I log in as "admin"

  @javascript
  Scenario: Information does not display when left blank
    When the following config values are set as admin:
      | searchbannerenable | 1 |
      | searchbanner |  |
    And I search for "toads" using the header global search box
    Then ".notifywarning" "css_element" should not exist
