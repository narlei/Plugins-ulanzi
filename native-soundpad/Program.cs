using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SoundpadConnector;
using SoundpadConnector.Response;
using SoundpadConnector.XML;

namespace UlanziSoundpadNative;

internal static class Program
{
    private static readonly ConcurrentDictionary<string, JObject> SettingsByContext = new();
    private static readonly ConcurrentDictionary<string, bool> RecordingByContext = new();
    private static readonly Soundpad Soundpad = new();
    private static readonly object CacheLock = new();

    private static ClientWebSocket? _socket;
    private static string _pluginUuid = "com.caios.ulanzideck.soundpad";
    private static string _address = "127.0.0.1";
    private static int _port = 3906;
    private static List<Category> _categoryCache = new();

    private static async Task<int> Main(string[] args)
    {
        try
        {
            ParseArgs(args);
            await Soundpad.ConnectAsync();
            await RefreshCache();
            await ConnectUlanzi();
            await ReceiveLoop();
            return 0;
        }
        catch (Exception ex)
        {
            File.AppendAllText("native-error.log", $"{DateTime.Now:u} {ex}\n");
            return 1;
        }
    }

    private static void ParseArgs(string[] args)
    {
        for (var i = 0; i < args.Length; i++)
        {
            var raw = args[i] ?? string.Empty;
            string key;
            string value;
            if (raw.Contains('='))
            {
                var idx = raw.IndexOf('=');
                key = raw[..idx].TrimStart('-', '/');
                value = raw[(idx + 1)..];
            }
            else
            {
                key = raw.TrimStart('-', '/');
                value = i + 1 < args.Length ? args[i + 1] : string.Empty;
                if (i + 1 < args.Length && !args[i + 1].StartsWith('-')) i++;
            }

            switch (key.ToLowerInvariant())
            {
                case "port" when int.TryParse(value, out var parsedPort):
                    _port = parsedPort;
                    break;
                case "address":
                case "host":
                    if (!string.IsNullOrWhiteSpace(value)) _address = value;
                    break;
                case "uuid":
                case "pluginuuid":
                    if (!string.IsNullOrWhiteSpace(value)) _pluginUuid = value;
                    break;
            }
        }
    }

    private static async Task RefreshCache()
    {
        var res = await Soundpad.GetCategories(true, true);
        if (res?.IsSuccessful == true && res.Value?.Categories != null)
        {
            lock (CacheLock)
            {
                _categoryCache = res.Value.Categories;
            }
        }
    }

    private static async Task ConnectUlanzi()
    {
        _socket = new ClientWebSocket();
        await _socket.ConnectAsync(new Uri($"ws://{_address}:{_port}"), CancellationToken.None);
        await Send(new JObject
        {
            ["code"] = 0,
            ["cmd"] = "connected",
            ["uuid"] = _pluginUuid,
            ["actionid"] = "",
            ["key"] = ""
        });
    }

    private static async Task ReceiveLoop()
    {
        if (_socket == null) return;
        var buffer = new byte[1024 * 64];
        while (_socket.State == WebSocketState.Open)
        {
            var result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            if (result.MessageType == WebSocketMessageType.Close) break;
            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            var msg = JObject.Parse(text);
            await HandleMessage(msg);
        }
    }

    private static async Task HandleMessage(JObject msg)
    {
        var cmd = GetString(msg, "cmd");
        if (string.IsNullOrWhiteSpace(cmd)) return;

        if (cmd == "add")
        {
            var ctx = BuildContext(msg);
            SettingsByContext[ctx] = GetParam(msg);
            return;
        }

        if (cmd == "paramfromapp" || cmd == "paramfromplugin")
        {
            var ctx = BuildContext(msg);
            var next = GetParam(msg);
            var curr = SettingsByContext.GetOrAdd(ctx, _ => new JObject());
            curr.Merge(next, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace });
            SettingsByContext[ctx] = curr;

            if (GetString(next, "property_inspector") == "refreshSounds")
            {
                await RefreshCache();
                await SendInspectorData(msg, curr);
            }
            return;
        }

        if (cmd == "run")
        {
            await HandleRun(msg);
            return;
        }

        if (cmd == "clear" && msg["param"] is JArray arr)
        {
            foreach (var item in arr.OfType<JObject>())
            {
                var ctx = BuildContext(item);
                SettingsByContext.TryRemove(ctx, out _);
                RecordingByContext.TryRemove(ctx, out _);
            }
        }
    }

    private static async Task HandleRun(JObject msg)
    {
        var ctx = BuildContext(msg);
        var actionId = GetString(msg, "actionid");
        var settings = SettingsByContext.TryGetValue(ctx, out var s) ? s : new JObject();

        if (actionId.EndsWith(".play", StringComparison.OrdinalIgnoreCase))
        {
            var soundIndex = ResolveSoundIndex(settings);
            if (soundIndex < 0) return;
            var ptp = GetBool(settings, "pushToPlay");
            var res = await Soundpad.PlaySound(soundIndex, ptp, false);
            if (res.IsSuccessful && GetBool(settings, "showSoundTitle"))
            {
                await SetTitle(msg, ResolveSoundTitle(soundIndex));
            }
            return;
        }

        if (actionId.EndsWith(".playrandom", StringComparison.OrdinalIgnoreCase))
        {
            var category = GetInt(settings, "categoryIndex", -1);
            if (category >= 0) await Soundpad.PlayRandomSoundFromCategory(category, false, false);
            else await Soundpad.PlayRandomSound(false, false);
            return;
        }

        if (actionId.EndsWith(".pause", StringComparison.OrdinalIgnoreCase))
        {
            await Soundpad.TogglePause();
            return;
        }

        if (actionId.EndsWith(".stop", StringComparison.OrdinalIgnoreCase))
        {
            await Soundpad.StopSound();
            return;
        }

        if (actionId.EndsWith(".remove", StringComparison.OrdinalIgnoreCase))
        {
            var index = GetInt(settings, "removeSoundIndex", -1);
            if (index < 0) return;
            await Soundpad.SelectIndex(index);
            await Soundpad.RemoveSelectedEntries(false);
            return;
        }

        if (actionId.EndsWith(".recordptt", StringComparison.OrdinalIgnoreCase))
        {
            var rec = RecordingByContext.TryGetValue(ctx, out var current) && current;
            if (rec) await Soundpad.StopRecording();
            else await Soundpad.StartRecordingMicrophone();
            RecordingByContext[ctx] = !rec;
            return;
        }

        if (actionId.EndsWith(".loadsoundlist", StringComparison.OrdinalIgnoreCase))
        {
            var path = GetString(settings, "soundListFileName");
            if (string.IsNullOrWhiteSpace(path)) return;
            await Soundpad.LoadSoundlist(path);
            await RefreshCache();
        }
    }

    private static async Task SendInspectorData(JObject msg, JObject current)
    {
        var selectedCategory = GetInt(current, "categoryIndex", -1);
        var categories = new JArray();
        var sounds = new JArray();

        lock (CacheLock)
        {
            foreach (var c in _categoryCache)
            {
                categories.Add(new JObject
                {
                    ["categoryName"] = c.Name,
                    ["categoryIndex"] = c.Index
                });
            }

            var source = Enumerable.Empty<Sound>();
            if (selectedCategory >= 0)
            {
                var cat = _categoryCache.FirstOrDefault(c => c.Index == selectedCategory);
                if (cat?.Sounds != null) source = cat.Sounds;
            }

            foreach (var s in source)
            {
                sounds.Add(new JObject
                {
                    ["soundName"] = s.Title,
                    ["soundIndex"] = s.Index
                });
            }
        }

        var outgoing = (JObject)current.DeepClone();
        outgoing["categories"] = categories;
        outgoing["sounds"] = sounds;

        await Send(new JObject
        {
            ["cmd"] = "paramfromapp",
            ["uuid"] = GetString(msg, "uuid"),
            ["actionid"] = GetString(msg, "actionid"),
            ["key"] = GetString(msg, "key"),
            ["param"] = outgoing
        });
    }

    private static async Task SetTitle(JObject msg, string title)
    {
        await Send(new JObject
        {
            ["cmd"] = "state",
            ["uuid"] = GetString(msg, "uuid"),
            ["actionid"] = GetString(msg, "actionid"),
            ["key"] = GetString(msg, "key"),
            ["param"] = new JObject
            {
                ["statelist"] = new JArray
                {
                    new JObject
                    {
                        ["uuid"] = GetString(msg, "uuid"),
                        ["key"] = GetString(msg, "key"),
                        ["actionid"] = GetString(msg, "actionid"),
                        ["type"] = 0,
                        ["state"] = 0,
                        ["textData"] = title ?? "",
                        ["showtext"] = true
                    }
                }
            }
        });
    }

    private static async Task Send(JObject payload)
    {
        if (_socket == null) return;
        var bytes = Encoding.UTF8.GetBytes(payload.ToString(Formatting.None));
        await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private static string BuildContext(JObject msg) =>
        $"{GetString(msg, "uuid")}___{GetString(msg, "key")}___{GetString(msg, "actionid")}";

    private static JObject GetParam(JObject msg) => msg["param"] as JObject ?? new JObject();

    private static int ResolveSoundIndex(JObject settings)
    {
        var byIndex = GetInt(settings, "soundIndex", -1);
        if (byIndex >= 0) return byIndex;

        var wanted = GetString(settings, "soundTitle");
        var category = GetInt(settings, "categoryIndex", -1);
        if (string.IsNullOrWhiteSpace(wanted)) return -1;

        lock (CacheLock)
        {
            IEnumerable<Category> categories = _categoryCache;
            if (category >= 0) categories = categories.Where(c => c.Index == category);
            foreach (var c in categories)
            {
                if (c?.Sounds == null) continue;
                var found = c.Sounds.FirstOrDefault(s => string.Equals(s.Title, wanted, StringComparison.OrdinalIgnoreCase));
                if (found != null) return found.Index;
            }
        }

        return -1;
    }

    private static string ResolveSoundTitle(int index)
    {
        lock (CacheLock)
        {
            foreach (var c in _categoryCache)
            {
                if (c?.Sounds == null) continue;
                var s = c.Sounds.FirstOrDefault(x => x.Index == index);
                if (s != null && !string.IsNullOrWhiteSpace(s.Title)) return s.Title;
            }
        }
        return "";
    }

    private static string GetString(JObject d, string key) => d[key]?.ToString() ?? "";

    private static int GetInt(JObject d, string key, int fallback) =>
        int.TryParse(GetString(d, key), out var parsed) ? parsed : fallback;

    private static bool GetBool(JObject d, string key)
    {
        var s = GetString(d, key);
        return string.Equals(s, "true", StringComparison.OrdinalIgnoreCase) || s == "1";
    }
}
