package com.example;

import static org.mockito.Mockito.when;

// Test scope: a test that sets the automation cookie is not a bypass.
class LoginServletTest {
    void skipsCaptchaForAutomation(org.apache.sling.api.SlingHttpServletRequest request) {
        when(request.getCookie("qa-automation")).thenReturn(null);
    }
}
