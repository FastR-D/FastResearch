package identity

import "testing"

func TestWorkspaceReturnTo(t *testing.T) {
	for input, want := range map[string]string{
		"/workspace?tool=fast-read": "/workspace?tool=fast-read",
		"/workspace?view=insight":   "/workspace?view=insight",
		"/workspace?view=team&tool=fast-read&fastcas=failed&next=https://other.test": "/workspace?view=team",
		"/workspace?tool=unknown":                "/workspace",
		"https://other.test/workspace?view=team": "/workspace",
		"//other.test/workspace":                 "/workspace",
		"/other":                                 "/workspace",
		"/workspace/../other":                    "/workspace",
		"":                                       "/workspace",
	} {
		if got := WorkspaceReturnTo(input); got != want {
			t.Errorf("%q: got %q, want %q", input, got, want)
		}
	}
}
