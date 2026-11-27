Feature: Synthetic payment application workflows
  All cases start with a fresh browser and the same synthetic seed.
  Use only the visible application UI. Do not call APIs or inspect app internals.
  Do not navigate away or reload to make a missing expected outcome appear.
  UI actions needed to complete the current When are allowed.

  @auth-login
  Scenario: Valid credentials open the authenticated home
    Given I open the sign-in page
    Then the sign-in heading is visible
    When I sign in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    And the authenticated home route is "/" or "/public"

  @auth-logout
  Scenario: Sign-out ends the authenticated session
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I sign out
    Then the sign-in page and URL are visible
    When I reload the current page
    Then the sign-in page and URL are visible

  @profile-name
  Scenario: A changed first name is retained
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I change my "First Name" to "Study"
    Then my "First Name" field is "Study"
    And the name shown in the side menu contains "Study"
    When I reload the current page
    Then my "First Name" field is "Study"

  @profile-email
  Scenario: An invalid email cannot be saved
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I enter "invalid-email" in the Email field and leave the field
    Then the profile form displays email error "Must contain a valid email address"
    And the profile Save control is visible and disabled
    When I reload the current page
    Then my "Email" field is "Santos.Runte65@gmail.com"

  @bank-create
  Scenario: A new bank account is retained
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I add bank "Study Credit Union" with routing "987654321" and account "123456789"
    Then bank "Study Credit Union" is visible exactly once
    When I reload the current page
    Then bank "Study Credit Union" is visible exactly once

  @bank-delete
  Scenario: An existing bank account is soft deleted
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I delete bank "Waters, King and O'Reilly Bank"
    Then bank "Waters, King and O'Reilly Bank" is visibly marked deleted
    When I reload the current page
    Then bank "Waters, King and O'Reilly Bank" is visibly marked deleted

  @transfer-pay
  Scenario: A payment records the requested amount and recipient
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I "Pay" "12" dollars to "Kristian Bradtke" with note "Study payment"
    Then a confirmation heading shows "Study payment"
    When I open my personal feed
    And I reload the current page
    Then my personal feed contains one visible "Study payment" transaction reading "Ted Parisian paid Kristian Bradtke" for $12.00

  @transfer-request
  Scenario: A request records the requested amount and recipient
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I request $12 from "Kristian Bradtke" with note "Study request"
    Then a confirmation heading shows "Study request"
    When I open my personal feed
    And I reload the current page
    Then my personal feed contains one visible "Study request" transaction reading "Ted Parisian requested Kristian Bradtke" for $12.00

  @feed-personal
  Scenario: Mine opens the personal feed
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I select the "Mine" feed using its visible control
    Then the "Personal" feed at "/personal" contains transactions

  @feed-friends
  Scenario: Friends opens the contacts feed
    Given I am signed in as "Heath93" with password "s3cret"
    Then the authenticated home identifies "Heath93"
    When I select the "Friends" feed using its visible control
    Then the "Contacts" feed at "/contacts" contains transactions
