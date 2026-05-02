cmake_minimum_required(VERSION 3.14)
project(PhantomCyberServer)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

# cpp-httplib (header-only HTTP server, no Boost/ASIO required)
FetchContent_Declare(httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG        v0.16.3
)
set(HTTPLIB_USE_OPENSSL_IF_AVAILABLE OFF CACHE BOOL "" FORCE)
set(HTTPLIB_COMPILE                  OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(httplib)

# nlohmann/json (header-only)
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
)
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
set(JSON_Install    OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(nlohmann_json)

find_package(OpenSSL REQUIRED)
find_package(CURL    REQUIRED)

add_executable(cybersec-server src/main.cpp)

target_include_directories(cybersec-server PRIVATE
  ${httplib_SOURCE_DIR}
)

target_link_libraries(cybersec-server PRIVATE
  nlohmann_json::nlohmann_json
  OpenSSL::SSL
  OpenSSL::Crypto
  CURL::libcurl
  pthread
)

# Copy runtime assets to build directory after compile
add_custom_command(TARGET cybersec-server POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/../data    ${CMAKE_BINARY_DIR}/data
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_SOURCE_DIR}/../frontend/public ${CMAKE_BINARY_DIR}/public
  COMMENT "Copying data and public assets to build directory"
)
