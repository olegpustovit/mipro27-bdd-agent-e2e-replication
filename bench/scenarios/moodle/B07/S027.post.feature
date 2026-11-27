@core @core_search
Feature: Show system information in the search interface

  Background:
    Given the following config values are set as admin:
      | enableglobalsearch | 1 |
      | searchengine | simpledb |
    And I log in as "admin"

  @javascript
  Scenario: Information displays when enabled
    When the following config values are set as admin:
      | searchbannerenable | 1 |
      | searchbanner | The search currently only finds frog-related content; we hope to fix it soon. |
    And I search for "toads" using the header global search box
    Then I should see "The search currently only finds frog-related content" in the ".notifywarning" "css_element"
