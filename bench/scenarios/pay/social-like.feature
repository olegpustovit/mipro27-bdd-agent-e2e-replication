Feature: Synthetic payment application workflows

  @social-like
  Scenario: Liking a transaction is retained exactly once
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I open the feed transaction where "Ted Parisian" charged "Lia Rosenbaum" "$204.68" with note "Request: WHjJ4qR2R2 to uBmeaz5pX"
    Then the transaction detail heading is visible
    And the displayed like count is a number
    When I record the displayed like count
    And I like the transaction
    Then the displayed like count is one greater and Like is disabled
    When I reload the current page
    Then the displayed like count is one greater and Like is disabled
