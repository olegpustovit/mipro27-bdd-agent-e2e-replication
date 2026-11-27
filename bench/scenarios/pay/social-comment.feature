Feature: Synthetic payment application workflows

  @social-comment
  Scenario: A comment is retained exactly once
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I open the feed transaction where "Ted Parisian" charged "Lia Rosenbaum" "$204.68" with note "Request: WHjJ4qR2R2 to uBmeaz5pX"
    Then the transaction detail heading is visible
    When I add comment "Study comment"
    Then comment "Study comment" is visible in the transaction's comments
    When I reload the current page
    Then comment "Study comment" is visible exactly once in the transaction's comments
