# BOB v3.5.5 - Enhanced Route Testing Report

## 📊 Test Summary
- **Timestamp**: 20250902_083754
- **Total Tests**: 9
- **Passed**: 0 ✅
- **Failed**: 9 ❌
- **Skipped**: 0 ⏭️
- **Success Rate**: 0.0%
- **Selenium Available**: True

## 🔐 Authentication Route Tests
- **auth_route_anonymous**: ❌ FAIL (25.84s)
  - Error: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=anonymous&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **auth_route_demo**: ❌ FAIL (25.89s)
  - Error: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=demo&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **auth_route_ai_agent**: ❌ FAIL (25.85s)
  - Error: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=ai-agent&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **auth_route_default**: ❌ FAIL (25.76s)
  - Error: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=true&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}

## 🎯 Goal Creation Tests
- **goal_creation_1**: ❌ FAIL (3.72s)
  - Error: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Goal")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8

- **goal_creation_2**: ❌ FAIL (3.75s)
  - Error: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Goal")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8


## 📖 Story Creation Tests
- **story_creation_1**: ❌ FAIL (3.22s)
  - Error: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Story")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8

- **story_creation_2**: ❌ FAIL (3.16s)
  - Error: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Story")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8


## 🔄 UI Workflow Integration
- **ui_workflow_integration**: ❌ FAIL (3.43s)
  - Error: Add Story button not found in stories table; Stories table not found

## ❌ Failed Tests Details

### auth_route_anonymous
- **Error**: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=anonymous&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **Execution Time**: 25.84s
- **Details**: ```json
{
  "auth_state": {
    "currentUrl": "https://bob20250810.web.app/?test-login=anonymous&test-mode=true",
    "displayName": null,
    "email": null,
    "isAnonymous": null,
    "testModeActive": false,
    "userExists": false,
    "userId": null
  },
  "test_indicators": {
    "test_badge": false,
    "test_user_label": false,
    "no_permission_errors": true
  },
  "url": "https://bob20250810.web.app?test-login=anonymous&test-mode=true"
}
```

### auth_route_demo
- **Error**: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=demo&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **Execution Time**: 25.89s
- **Details**: ```json
{
  "auth_state": {
    "currentUrl": "https://bob20250810.web.app/?test-login=demo&test-mode=true",
    "displayName": null,
    "email": null,
    "isAnonymous": null,
    "testModeActive": false,
    "userExists": false,
    "userId": null
  },
  "test_indicators": {
    "test_badge": false,
    "test_user_label": false,
    "no_permission_errors": true
  },
  "url": "https://bob20250810.web.app?test-login=demo&test-mode=true"
}
```

### auth_route_ai_agent
- **Error**: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=ai-agent&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **Execution Time**: 25.85s
- **Details**: ```json
{
  "auth_state": {
    "currentUrl": "https://bob20250810.web.app/?test-login=ai-agent&test-mode=true",
    "displayName": null,
    "email": null,
    "isAnonymous": null,
    "testModeActive": false,
    "userExists": false,
    "userId": null
  },
  "test_indicators": {
    "test_badge": false,
    "test_user_label": false,
    "no_permission_errors": true
  },
  "url": "https://bob20250810.web.app?test-login=ai-agent&test-mode=true"
}
```

### auth_route_default
- **Error**: Auth state: {'currentUrl': 'https://bob20250810.web.app/?test-login=true&test-mode=true', 'displayName': None, 'email': None, 'isAnonymous': None, 'testModeActive': False, 'userExists': False, 'userId': None}, Indicators: {'test_badge': False, 'test_user_label': False, 'no_permission_errors': True}
- **Execution Time**: 25.76s
- **Details**: ```json
{
  "auth_state": {
    "currentUrl": "https://bob20250810.web.app/?test-login=true&test-mode=true",
    "displayName": null,
    "email": null,
    "isAnonymous": null,
    "testModeActive": false,
    "userExists": false,
    "userId": null
  },
  "test_indicators": {
    "test_badge": false,
    "test_user_label": false,
    "no_permission_errors": true
  },
  "url": "https://bob20250810.web.app?test-login=true&test-mode=true"
}
```

### goal_creation_1
- **Error**: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Goal")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8

- **Execution Time**: 3.72s
- **Details**: ```json
{
  "goal_data": {
    "title": "Enhanced Route Test Goal - Marathon Training",
    "description": "Complete a full marathon in under 4 hours using enhanced authentication",
    "theme": "Health",
    "priority": "High",
    "status": "In Progress",
    "target_date": "2025-12-31"
  }
}
```

### goal_creation_2
- **Error**: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Goal")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8

- **Execution Time**: 3.75s
- **Details**: ```json
{
  "goal_data": {
    "title": "Enhanced Route Test Goal - Career Development",
    "description": "Achieve senior developer position through skill enhancement",
    "theme": "Career",
    "priority": "High",
    "status": "Not Started",
    "target_date": "2025-08-01"
  }
}
```

### story_creation_1
- **Error**: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Story")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8

- **Execution Time**: 3.22s
- **Details**: ```json
{
  "story_data": {
    "title": "Enhanced Route Test Story - User Authentication API",
    "description": "Implement comprehensive JWT-based authentication system",
    "priority": "P1",
    "points": 8,
    "status": "To Do"
  }
}
```

### story_creation_2
- **Error**: Message: invalid element state: Failed to execute 'querySelector' on 'Document': 'button:contains("Add Story")' is not a valid selector.
  (Session info: chrome=139.0.7258.155)
Stacktrace:
0   chromedriver                        0x0000000105186e00 cxxbridge1$str$ptr + 2742224
1   chromedriver                        0x000000010517ed00 cxxbridge1$str$ptr + 2709200
2   chromedriver                        0x0000000104cc90b8 cxxbridge1$string$len + 90520
3   chromedriver                        0x0000000104cced70 cxxbridge1$string$len + 114256
4   chromedriver                        0x0000000104cd133c cxxbridge1$string$len + 123932
5   chromedriver                        0x0000000104d528c4 cxxbridge1$string$len + 653732
6   chromedriver                        0x0000000104d51980 cxxbridge1$string$len + 649824
7   chromedriver                        0x0000000104d048f4 cxxbridge1$string$len + 334292
8   chromedriver                        0x000000010514a478 cxxbridge1$str$ptr + 2494024
9   chromedriver                        0x000000010514d6a4 cxxbridge1$str$ptr + 2506868
10  chromedriver                        0x000000010512b3b0 cxxbridge1$str$ptr + 2366848
11  chromedriver                        0x000000010514df4c cxxbridge1$str$ptr + 2509084
12  chromedriver                        0x000000010511c4a8 cxxbridge1$str$ptr + 2305656
13  chromedriver                        0x000000010516d644 cxxbridge1$str$ptr + 2637844
14  chromedriver                        0x000000010516d7d0 cxxbridge1$str$ptr + 2638240
15  chromedriver                        0x000000010517e94c cxxbridge1$str$ptr + 2708252
16  libsystem_pthread.dylib             0x0000000187283c0c _pthread_start + 136
17  libsystem_pthread.dylib             0x000000018727eb80 thread_start + 8

- **Execution Time**: 3.16s
- **Details**: ```json
{
  "story_data": {
    "title": "Enhanced Route Test Story - Dashboard Analytics",
    "description": "Create real-time analytics dashboard for user engagement",
    "priority": "P2",
    "points": 13,
    "status": "In Progress"
  }
}
```

### ui_workflow_integration
- **Error**: Add Story button not found in stories table; Stories table not found
- **Execution Time**: 3.43s
- **Details**: ```json
{
  "add_story_button_exists": false,
  "add_story_buttons_found": 0,
  "available_buttons": [
    "Sign in with Google"
  ],
  "clean_goal_cards": true,
  "goal_cards_count": 0,
  "stories_buttons_found": 0,
  "stories_table_exists": false
}
```

## 📁 Test Artifacts
- **JSON Report**: `./test-results/enhanced_route_test_results_20250902_083754.json`
- **Screenshots**: `./test-results/enhanced-routes`

## ⚠️ Deployment Recommendation
❌ **REVIEW REQUIRED** - 9 test(s) failed. Please review and fix issues before deployment.
